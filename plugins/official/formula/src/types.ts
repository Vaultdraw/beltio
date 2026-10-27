export const FORMULA_DATA_VERSION = 1;

/** Stored in `element.customData.latex`. width/height: natural px size of the stored SVG. */
export type FormulaData = {
  v: 1;
  source: string;
  display: boolean;
  color: string;
  width: number;
  height: number;
};

export type FormulaRequest = {
  source: string;
  display: boolean;
  color: string;
};

/** width/height are the natural px size of `svg`. */
export type FormulaRender =
  | { ok: true; svg: string; width: number; height: number }
  | { ok: false; error: string };

const isPositiveNumber = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

/** Returns the validated formula data, or null (unknown version / bad shape => plain image). */
export const getFormulaData = (
  el: { customData?: Record<string, unknown> } | null | undefined,
): FormulaData | null => {
  const raw = el?.customData?.latex as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  if (
    raw.v !== FORMULA_DATA_VERSION ||
    typeof raw.source !== "string" ||
    typeof raw.display !== "boolean" ||
    typeof raw.color !== "string" ||
    !isPositiveNumber(raw.width) ||
    !isPositiveNumber(raw.height)
  ) {
    return null;
  }
  return {
    v: 1,
    source: raw.source,
    display: raw.display,
    color: raw.color,
    width: raw.width,
    height: raw.height,
  };
};

const DELIMITERS: Array<[RegExp, boolean]> = [
  [/^\$\$([\s\S]*)\$\$$/, true],
  [/^\\\[([\s\S]*)\\\]$/, true],
  [/^\\\(([\s\S]*)\\\)$/, false],
  [/^\$([\s\S]*)\$$/, false],
];

/**
 * Strips one pair of math delimiters. `$$..$$` and `\[..\]` => display true,
 * `$..$` and `\(..\)` => display false, no delimiters => display undefined.
 */
export const parseFormulaInput = (
  text: string,
): { source: string; display: boolean | undefined } => {
  const trimmed = text.trim();
  for (const [re, display] of DELIMITERS) {
    const m = trimmed.match(re);
    if (m) {
      return { source: m[1].trim(), display };
    }
  }
  return { source: trimmed, display: undefined };
};

/** Worker protocol (renderer.ts <-> formula.worker.ts). */
export type WorkerIn =
  | { id: number; req: FormulaRequest }
  | { id: number; warm: true };
export type WorkerOut = { id: number; result: FormulaRender | null };

/** What the dialog hands back: the render plus the settings it was made with. */
export type RenderedFormula = {
  svg: string;
  width: number;
  height: number;
  source: string;
  display: boolean;
  color: string;
};

/** `FormulaData` from a rendered formula (what the element stores under `latex`). */
export const toFormulaData = (r: RenderedFormula): FormulaData => ({
  v: 1,
  source: r.source,
  display: r.display,
  color: r.color,
  width: r.width,
  height: r.height,
});

/** `getFormulaData` for a plain data value (what `ctx.scene.dataOf` returns). */
export const parseFormulaData = (raw: unknown): FormulaData | null =>
  getFormulaData({ customData: { latex: raw as Record<string, unknown> } });
