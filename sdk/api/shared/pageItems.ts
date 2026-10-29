/**
 * Page items (API 0.9.0), shared by the app's host and the mock: the checks
 * every `append`/`buildScene` call runs, the page setup a document is created
 * with, and the element builder. The builder never measures text: items come
 * wrapped and sized by the plugin, so the elements are plain records in the
 * editor's shape (`autoResize: false`, `originalText = text`), built in
 * linear time. Colours are the editor's default palette, so the drawing
 * follows the theme.
 */
import { PluginApiError, isJsonValue, utf8Length } from "./rules";
import { pageGeometry } from "./pages";
import {
  FONT_NAMES,
  MAX_COORD,
  MAX_DATA_BYTES,
  MAX_SIZE,
  MAX_TEXT,
  imageProblem,
} from "./sceneRules";
import { FONT_SIZE } from "./text";

import type {
  FontFamilyName,
  PageItem,
  PageRectFill,
  PageRequest,
  PageTextTone,
} from "@vaultdraw/api";

/** Items per `append` or `buildScene` call. */
export const MAX_PAGE_ITEMS = 100_000;
/** Pages a drawing may have (the editor's limit). */
export const MAX_PAGE_COUNT = 500;
const MAX_LINK = 2048;
const MAX_LINE_HEIGHT = 10;
const BAD_SCHEME = /^\s*(javascript|data|vbscript|file):/i;

/** The editor's numeric font ids (packages/common FONT_FAMILY), pinned by mockParity.test.ts. */
export const FONT_IDS: Readonly<Record<FontFamilyName, number>> = {
  Virgil: 1,
  Helvetica: 2,
  Cascadia: 3,
  Excalifont: 5,
  Nunito: 6,
  "Lilita One": 7,
  "Comic Shanns": 8,
  "Liberation Sans": 9,
};

/** Stroke colour per text tone (the editor's palette: black, gray 600, blue 800). */
export const TONE_COLORS: Readonly<Record<PageTextTone, string>> = {
  normal: "#1e1e1e",
  muted: "#868e96",
  code: "#1e1e1e",
  link: "#1971c2",
};

/** Background per box fill (gray 200, gray 50, blue 50, gray 50). */
export const FILL_COLORS: Readonly<Record<PageRectFill, string>> = {
  code: "#e9ecef",
  quote: "#f8f9fa",
  callout: "#e7f5ff",
  table: "#f8f9fa",
  none: "transparent",
};

/** Rules and placeholder boxes: gray 400. */
export const LINE_COLOR = "#ced4da";
/** The placeholder's family when no text item says otherwise. */
const PLACEHOLDER_FONT: FontFamilyName = "Helvetica";
const PLACEHOLDER_FONT_SIZE = 16;
const PLACEHOLDER_LINE_HEIGHT = 1.25;

const bad = (message: string) =>
  new PluginApiError("INVALID_ARGUMENT", message);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isBytes = (v: unknown): v is Uint8Array =>
  Object.prototype.toString.call(v) === "[object Uint8Array]";

const number = (v: unknown, what: string, min: number, max: number) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    throw bad(`${what} must be a number between ${min} and ${max}`);
  }
  return v;
};

const linkOk = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= MAX_LINK &&
  // eslint-disable-next-line no-control-regex
  !/[\u0000-\u001f]/.test(v) &&
  !BAD_SCHEME.test(v);

/** The page count of a call: a whole number from 1 to 500. */
export const checkPageCount = (v: unknown): number => {
  if (
    !Number.isInteger(v) ||
    (v as number) < 1 ||
    (v as number) > MAX_PAGE_COUNT
  ) {
    throw bad(`pageCount must be a whole number from 1 to ${MAX_PAGE_COUNT}`);
  }
  return v as number;
};

const checkBox = (it: Record<string, unknown>, at: string) => {
  number(it.page, `${at}.page`, 0, MAX_PAGE_COUNT - 1);
  if (!Number.isInteger(it.page)) {
    throw bad(`${at}.page must be a whole number`);
  }
  number(it.x, `${at}.x`, -MAX_COORD, MAX_COORD);
  number(it.y, `${at}.y`, -MAX_COORD, MAX_COORD);
  number(it.width, `${at}.width`, 0, MAX_SIZE);
  number(it.height, `${at}.height`, 0, MAX_SIZE);
};

/**
 * Throws INVALID_ARGUMENT (naming the first bad item) unless `items` is a
 * list of valid page items. Returns the list typed.
 */
export const checkPageItems = (items: unknown): readonly PageItem[] => {
  if (!Array.isArray(items)) {
    throw bad("items must be an array");
  }
  if (items.length > MAX_PAGE_ITEMS) {
    throw bad(`At most ${MAX_PAGE_ITEMS} items per call`);
  }
  for (let i = 0; i < items.length; i++) {
    const it: unknown = items[i];
    const at = `items[${i}]`;
    if (!isRecord(it)) {
      throw bad(`${at} must be an object`);
    }
    if (!["text", "rect", "line", "image"].includes(String(it.type))) {
      throw bad(`${at}.type must be "text", "rect", "line" or "image"`);
    }
    checkBox(it, at);
    switch (it.type) {
      case "text": {
        if (typeof it.text !== "string" || it.text.length > MAX_TEXT) {
          throw bad(
            `${at}.text must be a string of at most ${MAX_TEXT} characters`,
          );
        }
        number(it.fontSize, `${at}.fontSize`, FONT_SIZE.min, FONT_SIZE.max);
        if (!(FONT_NAMES as readonly unknown[]).includes(it.fontFamily)) {
          throw bad(`${at}.fontFamily must be one of ${FONT_NAMES.join(", ")}`);
        }
        number(it.lineHeight, `${at}.lineHeight`, 0.1, MAX_LINE_HEIGHT);
        if (
          it.align !== undefined &&
          it.align !== "left" &&
          it.align !== "center" &&
          it.align !== "right"
        ) {
          throw bad(`${at}.align must be "left", "center" or "right"`);
        }
        if (
          it.tone !== undefined &&
          !Object.hasOwn(TONE_COLORS, String(it.tone))
        ) {
          throw bad(
            `${at}.tone must be one of ${Object.keys(TONE_COLORS).join(", ")}`,
          );
        }
        if (it.link !== undefined && !linkOk(it.link)) {
          throw bad(
            `${at}.link must be a link of at most ${MAX_LINK} characters (no javascript:, data:, vbscript: or file:)`,
          );
        }
        if (it.data !== undefined) {
          if (!isRecord(it.data) || !isJsonValue(it.data)) {
            throw bad(`${at}.data must be a JSON object`);
          }
          if (utf8Length(JSON.stringify(it.data)) > MAX_DATA_BYTES) {
            throw bad(
              `${at}.data is larger than ${MAX_DATA_BYTES} bytes as JSON`,
            );
          }
        }
        break;
      }
      case "rect":
        if (!Object.hasOwn(FILL_COLORS, String(it.fill))) {
          throw bad(
            `${at}.fill must be one of ${Object.keys(FILL_COLORS).join(", ")}`,
          );
        }
        if (
          it.stroke !== undefined &&
          it.stroke !== "none" &&
          it.stroke !== "thin"
        ) {
          throw bad(`${at}.stroke must be "none" or "thin"`);
        }
        break;
      case "line":
        break;
      case "image":
        if (typeof it.mimeType !== "string") {
          throw bad(`${at}.mimeType must be a string`);
        }
        if (typeof it.target !== "string" || it.target.length > MAX_LINK) {
          throw bad(
            `${at}.target must be a string of at most ${MAX_LINK} characters`,
          );
        }
        if (
          it.alt !== undefined &&
          (typeof it.alt !== "string" || it.alt.length > MAX_TEXT)
        ) {
          throw bad(
            `${at}.alt must be a string of at most ${MAX_TEXT} characters`,
          );
        }
        if (it.bytes !== undefined) {
          if (!isBytes(it.bytes)) {
            throw bad(`${at}.bytes must be a Uint8Array`);
          }
          const problem = imageProblem({ mime: it.mimeType, bytes: it.bytes });
          if (problem) {
            throw bad(`${at}: ${problem.replace(/^mime/, "mimeType")}`);
          }
        }
        break;
      default:
        throw bad(`${at}.type must be "text", "rect", "line" or "image"`);
    }
  }
  return items as readonly PageItem[];
};

/** The editor's `appState.pageSetup` for a request and a page count (page mode on, plain paper). */
export const pageSetupFor = (
  request: PageRequest | undefined,
  pageCount: number,
) => {
  const geo = pageGeometry(request ?? {});
  const size = request?.size ?? "a4";
  return {
    enabled: true,
    layout: request?.layout ?? "separate",
    size: typeof size === "string" ? size : "custom",
    orientation:
      typeof size === "string"
        ? request?.orientation ?? "portrait"
        : "portrait",
    width: geo.width,
    height: geo.height,
    pageCount,
    paperTheme: "normal",
  };
};

/** What the builder needs from its caller: fresh ids, seeds and a clock. */
export interface BuildPageOptions {
  /** The page size and layout (page `i` starts at `i * pitch`). */
  setup?: PageRequest;
  /** The plugin's customData key for `data`; undefined drops `data`. */
  dataKey?: string;
  /** Image item (by identity) to its file id (SHA-1 of the bytes); an item without one becomes a placeholder. */
  fileIds?: ReadonlyMap<object, string>;
  id: () => string;
  seed: () => number;
  now: () => number;
}

/** A built picture, as the editor's file store takes it. */
export interface BuiltFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created: number;
}

export interface BuiltPage {
  /** Editor elements (plain records in the editor's shape), in item order. */
  elements: Record<string, unknown>[];
  /** One per distinct picture with bytes (a file already built is not repeated). */
  files: BuiltFile[];
}

const base = (
  type: string,
  x: number,
  y: number,
  width: number,
  height: number,
  o: BuildPageOptions,
  now: number,
): Record<string, unknown> => ({
  id: o.id(),
  type,
  x,
  y,
  width,
  height,
  angle: 0,
  strokeColor: TONE_COLORS.normal,
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  index: null,
  roundness: null,
  seed: o.seed(),
  version: 1,
  versionNonce: 0,
  isDeleted: false,
  boundElements: null,
  updated: now,
  created: now,
  link: null,
  locked: false,
});

const textElement = (
  el: Record<string, unknown>,
  text: string,
  fontSize: number,
  family: FontFamilyName,
  lineHeight: number,
  align: "left" | "center" | "right",
) =>
  Object.assign(el, {
    text,
    originalText: text,
    fontSize,
    fontFamily: FONT_IDS[family],
    textAlign: align,
    verticalAlign: "top",
    containerId: null,
    autoResize: false,
    lineHeight,
    baseFontSize: null,
    labelPosition: null,
  });

/** Base64 of `bytes`, in slices so a large picture does not overflow the call stack. */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  const SLICE = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + SLICE));
  }
  return btoa(binary);
};

/**
 * Elements for validated items. `known` holds file ids the drawing already
 * has, so their data URL is not built again.
 */
export const buildPageElements = (
  items: readonly PageItem[],
  o: BuildPageOptions,
  known: ReadonlySet<string> = new Set(),
): BuiltPage => {
  const pitch = pageGeometry(o.setup ?? {}).pitch;
  const now = o.now();
  const elements: Record<string, unknown>[] = [];
  const files: BuiltFile[] = [];
  const seen = new Set<string>(known);
  // A picture placeholder reads in the family of the text around it.
  const textFamily = items.find((i) => i.type === "text")?.fontFamily;
  for (const it of items) {
    const y = it.page * pitch + it.y;
    switch (it.type) {
      case "text": {
        const el = textElement(
          base("text", it.x, y, it.width, it.height, o, now),
          it.text,
          it.fontSize,
          it.fontFamily,
          it.lineHeight,
          it.align ?? "left",
        );
        el.strokeColor = TONE_COLORS[it.tone ?? "normal"];
        if (it.link !== undefined) {
          el.link = it.link;
        }
        if (it.data !== undefined && o.dataKey) {
          el.customData = { [o.dataKey]: structuredClone(it.data) };
        }
        elements.push(el);
        break;
      }
      case "rect": {
        const el = base("rectangle", it.x, y, it.width, it.height, o, now);
        el.backgroundColor = FILL_COLORS[it.fill];
        el.strokeColor = it.stroke === "thin" ? LINE_COLOR : "transparent";
        elements.push(el);
        break;
      }
      case "line": {
        const el = base(
          "line",
          it.x,
          y,
          Math.abs(it.width),
          Math.abs(it.height),
          o,
          now,
        );
        Object.assign(el, {
          strokeColor: LINE_COLOR,
          points: [
            [0, 0],
            [it.width, it.height],
          ],
          startBinding: null,
          endBinding: null,
          startArrowhead: null,
          endArrowhead: null,
          polygon: false,
        });
        elements.push(el);
        break;
      }
      case "image": {
        const fileId = it.bytes ? o.fileIds?.get(it) : undefined;
        if (fileId && it.bytes) {
          const el = base("image", it.x, y, it.width, it.height, o, now);
          Object.assign(el, {
            strokeColor: "transparent",
            fileId,
            status: "saved",
            scale: [1, 1],
            crop: null,
          });
          elements.push(el);
          if (!seen.has(fileId)) {
            seen.add(fileId);
            files.push({
              id: fileId,
              mimeType: it.mimeType,
              dataURL: `data:${it.mimeType};base64,${bytesToBase64(it.bytes)}`,
              created: now,
            });
          }
          break;
        }
        // No bytes: a box linked to where the picture is, with the alt text inside.
        const box = base("rectangle", it.x, y, it.width, it.height, o, now);
        box.strokeColor = LINE_COLOR;
        box.link = linkOk(it.target) ? it.target : null;
        elements.push(box);
        const label = textElement(
          base(
            "text",
            it.x + 8,
            y + 8,
            Math.max(1, it.width - 16),
            PLACEHOLDER_FONT_SIZE * PLACEHOLDER_LINE_HEIGHT,
            o,
            now,
          ),
          it.alt || it.target,
          PLACEHOLDER_FONT_SIZE,
          textFamily ?? PLACEHOLDER_FONT,
          PLACEHOLDER_LINE_HEIGHT,
          "left",
        );
        label.strokeColor = TONE_COLORS.muted;
        // Only the box carries the link: a linked label drew a second link icon over the box's.
        elements.push(label);
        break;
      }
    }
  }
  return { elements, files };
};

/** The image items that carry bytes: what the caller hashes before building. */
export const imagesToHash = (items: readonly PageItem[]) =>
  items.filter(
    (it): it is Extract<PageItem, { type: "image" }> & { bytes: Uint8Array } =>
      it.type === "image" && isBytes(it.bytes),
  );

/** SHA-1 of the bytes, hex, as the editor names files; each distinct array once. */
export const hashPageImages = async (
  items: readonly PageItem[],
  sha1: (bytes: Uint8Array) => Promise<string>,
): Promise<Map<object, string>> => {
  const out = new Map<object, string>();
  const byArray = new Map<Uint8Array, Promise<string>>();
  await Promise.all(
    imagesToHash(items).map(async (it) => {
      let hash = byArray.get(it.bytes);
      if (!hash) {
        hash = sha1(it.bytes);
        byArray.set(it.bytes, hash);
      }
      out.set(it, await hash);
    }),
  );
  return out;
};

/** SHA-1 through WebCrypto (the app and jsdom alike). */
export const sha1Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-1",
    bytes as BufferSource,
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
};
