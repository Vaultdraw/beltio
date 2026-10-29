/**
 * Width tables: the main thread measures every character the note uses once
 * (`ctx.text.measure`, the editor's own canvas measure) and the worker adds
 * the advances up. Canvas text widths are additive: the advance of each
 * character plus the kerning of each adjacent pair reproduces `measureText`
 * of the whole string to within 0.0004 px (review round 3, fable), so the
 * worker runs the editor's `wrapText` with identical line breaks and no
 * fonts, canvas or DOM.
 *
 * One `FontTable` per (family, size) in use: body, each heading level present,
 * callout titles and code. Pairs are measured only for the bigrams that
 * occur in the note, and kept only when they kern.
 */
import { fontKey, fontPlan, headingRole } from "./fonts";

import type { TextFont } from "@vaultdraw/api";

import type { NoteBlock, NoteDoc } from "@vaultdraw/api";
import type { Role, RoleName, RoleTable } from "./fonts";
import type { FontFamilyName, LayoutOptions } from "./types";

/** `ctx.text.measure`. */
export type MeasureFn = (
  font: TextFont,
  strings: readonly string[],
) => Float64Array;

/** The measured advances of one font. Typed arrays: transferable to a worker. */
export interface FontTable {
  family: FontFamilyName;
  size: number;
  bold: boolean;
  /** Code points measured, ascending. */
  codes: Uint32Array;
  /** Advance of each code point, scene pixels. */
  widths: Float64Array;
  /** Kerned pairs as `a * 65536 + b` (BMP only). */
  pairs: Uint32Array;
  /** Kerning of each pair: `width(ab) - width(a) - width(b)`. */
  kerns: Float64Array;
  /** Advance for a character that was not measured (the mean advance). */
  fallback: number;
}

export interface WidthTable {
  fonts: FontTable[];
}

/** Characters the block mappers add around note text. */
export const DECORATIONS = "•☐☑[]().…│─ 0123456789";
/** Printable ASCII, measured in every font so short unseen words still fit. */
const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
/** Kerning below this is float noise, not a kern. */
const KERN_EPSILON = 1e-3;

// --- sampling: which characters and pairs each role needs ------------------

class Samples {
  readonly bmp = new Uint8Array(0x10000);
  readonly astral = new Set<number>();
  readonly asciiPairs = new Uint8Array(128 * 128);
  readonly otherPairs = new Set<number>();
  empty = true;

  add(text: string) {
    const n = text.length;
    if (n === 0) {
      return;
    }
    this.empty = false;
    let prev = -1;
    for (let i = 0; i < n; i++) {
      let c = text.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
        const d = text.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          this.astral.add((c - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000);
          i++;
          prev = -1;
          continue;
        }
      }
      if (c === 10 || c === 13) {
        prev = -1;
        continue;
      }
      if (c === 9) {
        c = 32;
      }
      this.bmp[c] = 1;
      if (prev >= 0) {
        if (prev < 128 && c < 128) {
          this.asciiPairs[prev * 128 + c] = 1;
        } else {
          this.otherPairs.add(prev * 65536 + c);
        }
      }
      prev = c;
    }
  }

  /** The strings to measure: single characters first, then pairs. */
  strings(): { chars: string[]; codes: number[]; pairs: number[] } {
    const codes: number[] = [];
    for (let c = 0; c < 0x10000; c++) {
      if (this.bmp[c]) {
        codes.push(c);
      }
    }
    for (const c of [...this.astral].sort((a, b) => a - b)) {
      codes.push(c);
    }
    const pairs: number[] = [];
    for (let i = 0; i < 128 * 128; i++) {
      if (this.asciiPairs[i]) {
        pairs.push((i >> 7) * 65536 + (i & 127));
      }
    }
    for (const p of this.otherPairs) {
      pairs.push(p);
    }
    const chars = codes.map((c) => String.fromCodePoint(c));
    return { chars, codes, pairs };
  }
}

const walk = (blocks: readonly NoteBlock[], visit: (b: NoteBlock) => void) => {
  for (const b of blocks) {
    visit(b);
    if (
      b.kind === "blockquote" ||
      b.kind === "callout" ||
      b.kind === "footnoteDef"
    ) {
      walk(b.blocks, visit);
    }
  }
};

/** The text of each role, as the block mappers will emit it. */
export const collectSamples = (doc: NoteDoc): Map<RoleName, Samples> => {
  const out = new Map<RoleName, Samples>();
  const get = (r: RoleName) => {
    let s = out.get(r);
    if (!s) {
      s = new Samples();
      s.add(DECORATIONS);
      out.set(r, s);
    }
    return s;
  };
  get("body");
  walk(doc.blocks, (b) => {
    switch (b.kind) {
      case "heading":
        get(headingRole(b.level)).add(b.text);
        break;
      case "paragraph":
      case "listItem":
      case "html":
        get("body").add(b.text);
        break;
      case "code":
      case "math":
        get("code").add(b.kind === "code" ? b.text : b.latex);
        break;
      case "callout":
        get("title").add(b.title);
        break;
      case "table": {
        const s = get("code");
        for (const h of b.header) {
          s.add(h);
        }
        for (const row of b.rows) {
          for (const cell of row) {
            s.add(cell);
          }
        }
        break;
      }
      case "image":
      case "embed":
        get("body").add(b.alt ?? "");
        get("body").add(b.target);
        break;
      case "footnoteDef":
        get("body").add(b.label);
        break;
      default:
        break;
    }
  });
  return out;
};

// --- building ---------------------------------------------------------------

const measureFont = (
  measure: MeasureFn,
  role: Role,
  samples: Samples,
): FontTable => {
  // Every font also measures printable ASCII and the space pairs the
  // decorations create ("• " + word): bigrams of a space with every character.
  for (const c of ASCII) {
    samples.add(c);
  }
  for (const c of samples.strings().codes) {
    if (c < 0x10000 && c !== 32) {
      samples.add(` ${String.fromCodePoint(c)}`);
      samples.add(`${String.fromCodePoint(c)} `);
    }
  }
  const all = samples.strings();
  const pairStrings = all.pairs.map((p) =>
    String.fromCharCode(Math.floor(p / 65536), p % 65536),
  );
  const font: TextFont = role.bold
    ? { family: role.family, size: role.size, bold: true }
    : { family: role.family, size: role.size };
  const widths = measure(font, [...all.chars, ...pairStrings]);
  const n = all.codes.length;
  const advance = new Map<number, number>();
  let sum = 0;
  for (let i = 0; i < n; i++) {
    advance.set(all.codes[i], widths[i]);
    sum += widths[i];
  }
  const keptPairs: number[] = [];
  const keptKerns: number[] = [];
  for (let i = 0; i < all.pairs.length; i++) {
    const p = all.pairs[i];
    const a = Math.floor(p / 65536);
    const b = p % 65536;
    const kern = widths[n + i] - (advance.get(a) ?? 0) - (advance.get(b) ?? 0);
    if (Math.abs(kern) > KERN_EPSILON) {
      keptPairs.push(p);
      keptKerns.push(kern);
    }
  }
  return {
    family: role.family,
    size: role.size,
    bold: role.bold,
    codes: Uint32Array.from(all.codes),
    widths: Float64Array.from(all.codes, (c) => advance.get(c) ?? 0),
    pairs: Uint32Array.from(keptPairs),
    kerns: Float64Array.from(keptKerns),
    fallback: n ? sum / n : role.size * 0.5,
  };
};

/**
 * Builds the width table for a note on the main thread: one `measure` call
 * per font role the note uses. About 2–10 ms for a 50,000-word note.
 */
export const buildWidthTable = (
  measure: MeasureFn,
  doc: NoteDoc,
  opts: Pick<LayoutOptions, "fonts" | "fontSize" | "boldHeadings">,
): WidthTable => {
  const roles = fontPlan(opts.fonts, opts.fontSize, opts.boldHeadings);
  const samples = collectSamples(doc);
  // Roles sharing (family, size) share one table.
  const byKey = new Map<string, { role: Role; samples: Samples }>();
  for (const [name, s] of samples) {
    const role = roles[name];
    const key = fontKey(role.family, role.size, role.bold);
    const cur = byKey.get(key);
    if (cur) {
      // Merge: measure the union once.
      const { chars } = s.strings();
      for (const c of chars) {
        cur.samples.add(c);
      }
      for (const p of s.otherPairs) {
        cur.samples.otherPairs.add(p);
      }
      for (let i = 0; i < s.asciiPairs.length; i++) {
        if (s.asciiPairs[i]) {
          cur.samples.asciiPairs[i] = 1;
        }
      }
    } else {
      byKey.set(key, { role, samples: s });
    }
  }
  const fonts: FontTable[] = [];
  for (const { role, samples: s } of byKey.values()) {
    fonts.push(measureFont(measure, role, s));
  }
  return { fonts };
};

/** The buffers to pass as `postMessage` transferables (the table is consumed). */
export const widthTableTransferables = (table: WidthTable): ArrayBuffer[] =>
  table.fonts.flatMap((f) => [
    f.codes.buffer as ArrayBuffer,
    f.widths.buffer as ArrayBuffer,
    f.pairs.buffer as ArrayBuffer,
    f.kerns.buffer as ArrayBuffer,
  ]);

// --- measuring with a table -------------------------------------------------

/** Sums advances and kerns of a string, as canvas `measureText` would. */
export class LineMeasurer {
  private readonly dense: Float64Array;
  private readonly astral: Map<number, number> | null;
  private readonly kernFirst: Uint8Array | null;
  private readonly kerns: Map<number, number> | null;
  private readonly fallback: number;

  constructor(table: FontTable) {
    this.fallback = table.fallback;
    let max = 0;
    let astral: Map<number, number> | null = null;
    for (let i = 0; i < table.codes.length; i++) {
      const c = table.codes[i];
      if (c < 0x10000) {
        max = Math.max(max, c);
      } else {
        (astral ??= new Map()).set(c, table.widths[i]);
      }
    }
    this.astral = astral;
    this.dense = new Float64Array(max + 1).fill(table.fallback);
    for (let i = 0; i < table.codes.length; i++) {
      const c = table.codes[i];
      if (c < 0x10000) {
        this.dense[c] = table.widths[i];
      }
    }
    if (table.pairs.length) {
      this.kernFirst = new Uint8Array(0x10000);
      this.kerns = new Map();
      for (let i = 0; i < table.pairs.length; i++) {
        const p = table.pairs[i];
        this.kernFirst[Math.floor(p / 65536)] = 1;
        this.kerns.set(p, table.kerns[i]);
      }
    } else {
      this.kernFirst = null;
      this.kerns = null;
    }
  }

  width(text: string): number {
    const dense = this.dense;
    const limit = dense.length;
    const kernFirst = this.kernFirst;
    let w = 0;
    let prev = -1;
    const n = text.length;
    for (let i = 0; i < n; i++) {
      let c = text.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
        const d = text.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          const cp = (c - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000;
          w += this.astral?.get(cp) ?? this.fallback;
          i++;
          prev = -1;
          continue;
        }
      }
      if (c === 9) {
        c = 32;
      }
      w += c < limit ? dense[c] : this.fallback;
      if (kernFirst !== null && prev >= 0 && kernFirst[prev] === 1) {
        const k = this.kerns!.get(prev * 65536 + c);
        if (k !== undefined) {
          w += k;
        }
      }
      prev = c;
    }
    return w;
  }
}

/** One measurer per font string (`fontKey`), ready for `wrapText`. */
export const createMeasurers = (
  table: WidthTable,
): Map<string, LineMeasurer> => {
  const out = new Map<string, LineMeasurer>();
  for (const f of table.fonts) {
    out.set(fontKey(f.family, f.size, f.bold), new LineMeasurer(f));
  }
  return out;
};

/** The roles a layout uses, for callers that need sizes without a table. */
export const layoutRoles = (
  opts: Pick<LayoutOptions, "fonts" | "fontSize" | "boldHeadings">,
): RoleTable => fontPlan(opts.fonts, opts.fontSize, opts.boldHeadings);
