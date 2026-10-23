/**
 * The one scene -> image renderer behind every thumbnail: scene parse + caps,
 * standard colours, and two outputs (SVG data URL for in-memory snapshots, PNG
 * blob for the disk cache). `@excalidraw/excalidraw` is only imported
 * dynamically, when the first job runs.
 */
import { fitThumb } from "./fit";
import { DEFAULT_THUMB_MAX_ELEMENTS } from "./limits";
import { RenderCancelled, sceneSlicing, yieldToMain } from "./slicing";
import { withStandardColors } from "./standardColors";

/**
 * PNG renderer generation. Bumping it re-renders every cached thumbnail (the
 * PNG and fail-marker names carry the version) and retries failed scenes.
 * v2 (2026-10-21): device-pixel density, fixed 4:3 box, padded fit.
 */
export const RENDER_VERSION = 2;

/**
 * Version sent to the cache for PNGs rendered at `density`: a 1x render is
 * never served to a Retina display (and vice versa).
 */
export const pngRenderVersion = (density: number) =>
  RENDER_VERSION * 10 + density;

/**
 * Fail-marker generation. Bump it when the failure rules change. Markers also
 * carry the element cap they were written under, so raising or lowering
 * `interface.thumbnail_max_elements` retries only the drawings that failed;
 * cached PNGs stay valid. Generation 0 shared the PNG version; 1 retried the
 * "too-many" markers of the 600 cap; 2 (2026-10-24) adds the cap.
 */
export const FAIL_MARKER_GEN = 2;

/** Version of the fail markers written and honoured at `density` under `cap`. */
export const failMarkerVersion = (density: number, cap = maxElements) =>
  (FAIL_MARKER_GEN * 100000 + Math.min(cap, 99999)) * 100 +
  pngRenderVersion(density);

// SVG data URLs (history rows, link cards, templates).
export const THUMBNAIL_MAX_SIZE = 240;
/**
 * Cap for the SVG previews. Deliberately separate from (and lower than)
 * THUMB_MAX_ELEMENTS: exportToSvg is not time-sliced, so a whole SVG render is
 * one task, and each preview's DOM/data-URL size grows with the scene. The
 * PNG cap is higher only because its paint is sliced.
 */
export const THUMBNAIL_MAX_ELEMENTS = 2000;

// PNG disk cache: box geometry in ./fit.ts.
/**
 * Element cap for the PNG render (default and why: ./limits.ts). Painting,
 * restore and bounds are time-sliced (./slicing.ts), so the longest task is
 * the JSON parse, not the whole render. A preference sets it live.
 */
export const THUMB_MAX_ELEMENTS = DEFAULT_THUMB_MAX_ELEMENTS;
let maxElements = THUMB_MAX_ELEMENTS;
export const getThumbMaxElements = () => maxElements;
export const setThumbMaxElements = (n: number) => {
  maxElements = n;
};
/** Above this the scene is not parsed at all (long task); fail marker. */
export const THUMB_MAX_JSON_BYTES = 8 * 1024 * 1024;
/** Above this the embedded images are dropped (placeholders): bounds decode cost. */
export const THUMB_FILES_JSON_BYTES = 4 * 1024 * 1024;

export type FailReason =
  | "invalid"
  | "empty"
  | "too-many"
  | "too-large"
  | "encode"
  | "error"
  /** Stopped at a yield (unwatched, scrolled past, disposed): never a marker. */
  | "cancelled";
export type PngResult =
  | { kind: "png"; blob: Blob }
  | { kind: "fail"; reason: FailReason };

export type RenderSvg = (json: string) => Promise<string | null>;
/** `cancelled` is polled after every yield; true stops the render. */
export type RenderPng = (
  json: string,
  density?: number,
  cancelled?: () => boolean,
) => Promise<PngResult>;

type Scene = { elements: any[]; appState: any; files: any };

const parseScene = (
  json: string,
  limits: {
    maxElements: number;
    maxJsonChars?: number;
    dropFilesAbove?: number;
  },
): Scene | FailReason => {
  if (limits.maxJsonChars !== undefined && json.length > limits.maxJsonChars) {
    return "too-large";
  }
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    return "invalid";
  }
  const elements = data?.elements;
  if (!Array.isArray(elements)) {
    return "invalid";
  }
  if (elements.length === 0) {
    return "empty";
  }
  if (elements.length > limits.maxElements) {
    return "too-many";
  }
  const dropFiles =
    limits.dropFilesAbove !== undefined && json.length > limits.dropFilesAbove;
  return {
    elements,
    appState: {
      ...(data.appState ?? {}),
      exportBackground: true,
      exportEmbedScene: false,
    },
    files: dropFiles ? {} : data.files ?? {},
  };
};

const toDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Scene JSON -> SVG data URL, or null (empty/invalid/huge). */
export const renderSceneToSvgDataUrl: RenderSvg = async (json) => {
  const scene = parseScene(json, { maxElements: THUMBNAIL_MAX_ELEMENTS });
  if (typeof scene === "string") {
    return null;
  }
  const { exportToSvg } = await import("@excalidraw/excalidraw");
  return withStandardColors(async () => {
    const svg = await exportToSvg({
      elements: scene.elements,
      appState: scene.appState,
      files: scene.files,
      exportPadding: 8,
      renderEmbeddables: false,
      skipInliningFonts: true,
    });
    const w = parseFloat(svg.getAttribute("width") || "0");
    const h = parseFloat(svg.getAttribute("height") || "0");
    if (w > 0 && h > 0) {
      const k = THUMBNAIL_MAX_SIZE / Math.max(w, h);
      svg.setAttribute("width", String(Math.round(w * k)));
      svg.setAttribute("height", String(Math.round(h * k)));
    }
    return toDataUrl(new XMLSerializer().serializeToString(svg));
  });
};

const releaseCanvas = (canvas: HTMLCanvasElement) => {
  canvas.width = 0; // release the backing store (WebKit canvas memory cap)
};

const canvasToPng = async (canvas: HTMLCanvasElement): Promise<Blob | null> => {
  try {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    // WKWebView silently falls back to PNG for unsupported types; be explicit.
    return blob && blob.type === "image/png" ? blob : null;
  } finally {
    releaseCanvas(canvas);
  }
};

/**
 * Scene JSON -> opaque PNG of the fixed 4:3 thumbnail box at `density`
 * (fitThumb), standard light colours.
 */
export const renderScenePng: RenderPng = async (json, density = 1, cancelled) =>
  renderPng(json, density, true, cancelled);

/** `sliced` false is the one-task render (pixel reference in tests). */
export const renderPng = async (
  json: string,
  density: number,
  sliced: boolean,
  cancelled?: () => boolean,
): Promise<PngResult> => {
  const scene = parseScene(json, {
    maxElements,
    maxJsonChars: THUMB_MAX_JSON_BYTES,
    dropFilesAbove: THUMB_FILES_JSON_BYTES,
  });
  if (typeof scene === "string") {
    return { kind: "fail", reason: scene };
  }
  if (sliced) {
    await yieldToMain(); // the parse is one task; restore starts in the next
    if (cancelled?.()) {
      return { kind: "fail", reason: "cancelled" };
    }
  }
  try {
    const { exportToCanvas } = await import("@excalidraw/excalidraw");
    return await withStandardColors(async (): Promise<PngResult> => {
      let fit = fitThumb(1, 1, density);
      const content = await exportToCanvas({
        elements: scene.elements,
        appState: { ...scene.appState, exportWithDarkMode: false },
        files: scene.files,
        exportPadding: 0, // padding is in device pixels (fitThumb)
        getDimensions: (width: number, height: number) => {
          fit = fitThumb(width, height, density);
          return { width: fit.width, height: fit.height, scale: fit.scale };
        },
        slicing: sliced ? sceneSlicing(cancelled) : undefined,
      });
      const box = document.createElement("canvas");
      box.width = fit.boxWidth;
      box.height = fit.boxHeight;
      const ctx = box.getContext("2d");
      if (!ctx) {
        releaseCanvas(content);
        releaseCanvas(box);
        return { kind: "fail", reason: "encode" };
      }
      ctx.fillStyle = scene.appState.viewBackgroundColor || "#ffffff";
      ctx.fillRect(0, 0, box.width, box.height);
      ctx.drawImage(content, fit.x, fit.y);
      releaseCanvas(content);
      const blob = await canvasToPng(box);
      return blob ? { kind: "png", blob } : { kind: "fail", reason: "encode" };
    });
  } catch (err) {
    return {
      kind: "fail",
      reason: err instanceof RenderCancelled ? "cancelled" : "error",
    };
  }
};
