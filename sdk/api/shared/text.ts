/**
 * `ctx.text` and `ctx.fonts` rules shared by the app's host and the mock:
 * argument checks, the editor's line heights (packages/common
 * font-metadata.ts, tied by sdk/api/test/mockParity.test.ts) and the mock's
 * stand-in measure (every character is `size * 0.5` wide; the app measures
 * with the canvas).
 */
import { PluginApiError } from "./rules";

import type { FontFamilyName, TextFont } from "@vaultdraw/api";

export const MAX_MEASURE_STRINGS = 100_000;
export const MAX_MEASURE_CHARS = 4_000_000;
export const FONT_SIZE = { min: 1, max: 1000 };
/** How long `fonts.ensure` waits before FONT_UNAVAILABLE. */
export const FONT_TIMEOUT_MS = 10_000;
/** What `fonts.ensure` loads when no text is given: printable ASCII. */
export const DEFAULT_FONT_SAMPLE = Array.from({ length: 95 }, (_, i) =>
  String.fromCharCode(32 + i),
).join("");

/** Line height per family, as a multiple of the font size. */
export const LINE_HEIGHTS: Readonly<Record<FontFamilyName, number>> = {
  Excalifont: 1.25,
  Nunito: 1.25,
  "Lilita One": 1.15,
  "Comic Shanns": 1.25,
  Virgil: 1.25,
  Helvetica: 1.15,
  Cascadia: 1.2,
  "Liberation Sans": 1.15,
};

const bad = (message: string) =>
  new PluginApiError("INVALID_ARGUMENT", message);

export const checkFamily = (family: unknown): FontFamilyName => {
  if (typeof family !== "string" || !Object.hasOwn(LINE_HEIGHTS, family)) {
    throw bad(`Unknown font family "${String(family)}"`);
  }
  return family as FontFamilyName;
};

export const checkFont = (font: unknown): TextFont => {
  if (!font || typeof font !== "object") {
    throw bad("font must be { family, size }");
  }
  const { family, size } = font as Record<string, unknown>;
  if (
    typeof size !== "number" ||
    !Number.isFinite(size) ||
    size < FONT_SIZE.min ||
    size > FONT_SIZE.max
  ) {
    throw bad(
      `font.size must be between ${FONT_SIZE.min} and ${FONT_SIZE.max}`,
    );
  }
  return { family: checkFamily(family), size };
};

export const checkStrings = (strings: unknown): readonly string[] => {
  if (!Array.isArray(strings)) {
    throw bad("strings must be an array");
  }
  if (strings.length > MAX_MEASURE_STRINGS) {
    throw bad(`At most ${MAX_MEASURE_STRINGS} strings per call`);
  }
  let chars = 0;
  for (const s of strings) {
    if (typeof s !== "string") {
      throw bad("Every string to measure must be a string");
    }
    chars += s.length;
  }
  if (chars > MAX_MEASURE_CHARS) {
    throw bad(`At most ${MAX_MEASURE_CHARS} characters per call`);
  }
  return strings;
};

export const checkFamilies = (
  families: unknown,
  text: unknown,
): { families: FontFamilyName[]; text: string } => {
  if (!Array.isArray(families)) {
    throw bad("families must be an array");
  }
  if (text !== undefined && typeof text !== "string") {
    throw bad("text must be a string");
  }
  return {
    families: [...new Set(families.map(checkFamily))],
    text: text || DEFAULT_FONT_SAMPLE,
  };
};

/** The mock's measure: `size * 0.5` per UTF-16 unit. */
export const fakeMeasure = (font: TextFont, strings: readonly string[]) =>
  Float64Array.from(strings, (s) => s.length * font.size * 0.5);
