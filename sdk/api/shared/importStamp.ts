/**
 * Has the user edited an imported note? (hunter A-2, 2026-10-30). The import stamps every element
 * it writes with a fingerprint of what the user can change (position, size, text, colours, font,
 * link, group, lock, order) and the number of elements it wrote. The app's own passes keep the
 * stamp true: "Update to my theme and font" re-stamps a note that was untouched before it, and a
 * filled-in picture (box and label replaced by one image) counts as two of the elements. Loading a
 * drawing fills in its drawing order (`index`) and bumps `version` and `updated` on every element,
 * so none of those are part of the fingerprint.
 *
 * A drawing without stamps (imported before this) is "unknown": a folder or vault re-import leaves
 * it alone and says it could not tell, never rewrites it on a guess.
 */
export const STAMP_KEY = "vaultdraw.import";

type El = Record<string, unknown>;
/**
 * `a`, `w` (hunter A-9): a text's auto-size switch, and the width of a free text that wraps at a
 * fixed width. Dragging a text's side handle changes them while its source stays. Stamps written
 * before they existed have neither and skip the check.
 */
type Stamp = { f: string; o: number; n: number; a?: boolean; w?: number };

export type EditState = "untouched" | "edited" | "unknown";

/** The import's picture placeholder label: a text inset 8 px into the rectangle before it. */
const isPlaceholderLabel = (e: El, prev: El | undefined) =>
  e.type === "text" &&
  prev?.type === "rectangle" &&
  e.x === (prev.x as number) + 8 &&
  e.y === (prev.y as number) + 8;

const FIELDS = [
  "type",
  "x",
  "y",
  "width",
  "height",
  "angle",
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
  "groupIds",
  "frameId",
  "roundness",
  "link",
  "locked",
  "originalText",
  "fontSize",
  "fontFamily",
  "textAlign",
  "verticalAlign",
  "containerId",
  "points",
  "fileId",
  "crop",
  "scale",
] as const;

/**
 * Text keeps its source (`originalText`), not its wrapped lines or box size: the editor re-wraps
 * and re-measures with the real font on load. A placeholder label's text and link are the
 * picture fill's to change ("Web page, not a picture: …").
 */
const skipped = (e: El, label: boolean): ReadonlySet<string> =>
  label
    ? new Set(["originalText", "link", "width", "height"])
    : e.type === "text"
    ? new Set(["width", "height"])
    : new Set();

/** FNV-1a, 32 bit, base 36: small and fast; this guards against edits, not attackers. */
const hash = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};

const customWithoutStamp = (e: El) => {
  if (typeof e.customData !== "object" || e.customData === null) {
    return null;
  }
  const { [STAMP_KEY]: _s, ...rest } = e.customData as Record<string, unknown>;
  return Object.keys(rest).length ? rest : null;
};

export const fingerprint = (e: El, prev?: El): string => {
  const skip = skipped(e, isPlaceholderLabel(e, prev));
  const parts: unknown[] = [];
  for (const k of FIELDS) {
    parts.push(skip.has(k) ? null : e[k] ?? null);
  }
  parts.push(customWithoutStamp(e));
  return hash(JSON.stringify(parts));
};

const stampOf = (e: El): Stamp | null => {
  const s = (e.customData as Record<string, unknown> | undefined)?.[STAMP_KEY];
  return s &&
    typeof s === "object" &&
    typeof (s as Stamp).f === "string" &&
    typeof (s as Stamp).o === "number" &&
    typeof (s as Stamp).n === "number"
    ? (s as Stamp)
    : null;
};

const live = (els: unknown): El[] =>
  (Array.isArray(els) ? (els as El[]) : []).filter((e) => e.isDeleted !== true);

/** The text-box part of a stamp: auto-size, and the width when the text wraps at a fixed one. */
const textBox = (e: El): { a?: boolean; w?: number } => {
  if (e.type !== "text") {
    return {};
  }
  const a = e.autoResize !== false;
  return !a && !e.containerId && typeof e.width === "number"
    ? { a, w: Math.round(e.width) }
    : { a };
};

/** True when the user changed how a text wraps (side handle, auto-size switched). */
const boxChanged = (e: El, s: Stamp): boolean => {
  if (s.a === undefined) {
    return false;
  }
  const now = textBox(e);
  return (
    now.a !== s.a || (s.w !== undefined && Math.abs((now.w ?? -1e9) - s.w) > 1)
  );
};

/** Stamps every element in place (the order of `elements` is the drawing order). */
export const stampElements = (elements: readonly unknown[]): void => {
  const els = live(elements);
  els.forEach((e, i) => {
    const f = fingerprint(e, els[i - 1]);
    e.customData = {
      ...(typeof e.customData === "object" && e.customData !== null
        ? (e.customData as object)
        : {}),
      [STAMP_KEY]: { f, o: i, n: els.length, ...textBox(e) },
    };
  });
};

/** A picture the fill put where a box and its label were: an image with a link and no stamp. */
const filledPicture = (e: El) =>
  e.type === "image" && typeof e.link === "string" && stampOf(e) === null;

/** Whether the drawing is still as the import (or the app's own update) left it. */
export const editState = (scene: { elements?: unknown }): EditState => {
  const all = Array.isArray(scene.elements) ? (scene.elements as El[]) : [];
  if (!all.some((e) => stampOf(e) !== null)) {
    return "unknown";
  }
  if (all.some((e) => e.isDeleted === true)) {
    return "edited";
  }
  let n = -1;
  let lastOrder = -1;
  let stamped = 0;
  let filled = 0;
  for (let i = 0; i < all.length; i++) {
    const e = all[i];
    const s = stampOf(e);
    if (!s) {
      if (filledPicture(e)) {
        filled++;
        continue;
      }
      return "edited"; // added by the user
    }
    if (n === -1) {
      n = s.n;
    }
    if (s.n !== n || s.o <= lastOrder) {
      return "edited"; // pasted from another note, or reordered
    }
    lastOrder = s.o;
    if (s.f !== fingerprint(e, all[i - 1]) || boxChanged(e, s)) {
      return "edited";
    }
    stamped++;
  }
  return stamped + 2 * filled === n ? "untouched" : "edited";
};
