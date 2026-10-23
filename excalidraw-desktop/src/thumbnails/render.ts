/**
 * The one scene -> image renderer behind every thumbnail: scene parse + caps,
 * standard colours, and two outputs (SVG data URL for in-memory snapshots, PNG
 * blob for the disk cache). `@excalidraw/excalidraw` is only imported
 * dynamically, when the first job runs.
 */
import { fitThumb } from "./fit";
import { sceneSlicing, yieldToMain } from "./slicing";
import { withStandardColors } from "./standardColors";

/**
 * PNG renderer generation. Bumping it re-renders every cached thumbnail (the
 * PNG and fail-marker names carry the version) and retries failed scenes.
 * v2 (2026-10-21): device-pixel density, fixed 4:3 box, padded fit.
 * v3 (2026-10-23): same pixels; retries the "too-many" fail markers left by
 * the old 600-element cap.
 */
export const RENDER_VERSION = 3;

/**
 * Version sent to the cache for PNGs rendered at `density`: a 1x render is
 * never served to a Retina display (and vice versa).
 */
export const pngRenderVersion = (density: number) =>
  RENDER_VERSION * 10 + density;

// SVG data URLs (history rows, link cards, templates).
export const THUMBNAIL_MAX_SIZE = 240;
export const THUMBNAIL_MAX_ELEMENTS = 2000;

// PNG disk cache: box geometry in ./fit.ts.
/**
 * Element cap for the PNG render. Painting is time-sliced (./slicing.ts) and
 * the linear pre-paint phases (parse, restore, bounds) each run in their own
 * task, so the longest task is the slowest phase, not the whole render.
 * 2026-10-23 (e2e/thumbnailsBlocking.spec.ts, Chromium 4x, quiet machine):
 * longest task 25.7 ms at 2000, 36.5 at 3000, 46.5 at 4000 and 58 at 5000
 * elements, so the 50 ms long-task budget holds up to 4000.
 * Was 600 before slicing (one-task render: 42 ms at 500 elements).
 */
export const THUMB_MAX_ELEMENTS = 4000;
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
  | "error";
export type PngResult =
  | { kind: "png"; blob: Blob }
  | { kind: "fail"; reason: FailReason };

export type RenderSvg = (json: string) => Promise<string | null>;
export type RenderPng = (json: string, density?: number) => Promise<PngResult>;

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
export const renderScenePng: RenderPng = async (json, density = 1) =>
  renderPng(json, density, true);

/** `sliced` false is the one-task render (pixel reference in tests). */
export const renderPng = async (
  json: string,
  density: number,
  sliced: boolean,
): Promise<PngResult> => {
  const scene = parseScene(json, {
    maxElements: THUMB_MAX_ELEMENTS,
    maxJsonChars: THUMB_MAX_JSON_BYTES,
    dropFilesAbove: THUMB_FILES_JSON_BYTES,
  });
  if (typeof scene === "string") {
    return { kind: "fail", reason: scene };
  }
  if (sliced) {
    await yieldToMain(); // the parse is one task; restore starts in the next
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
        slicing: sliced ? sceneSlicing() : undefined,
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
  } catch {
    return { kind: "fail", reason: "error" };
  }
};
