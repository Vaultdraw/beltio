/**
 * Line wrapping with the editor's own algorithm. `getWrappedTextLines` is
 * imported from packages/element/src/textWrapping.ts (bundled; see
 * excalidrawCommonShim.ts for what it pulls in) and its text metrics
 * provider is replaced by the width table, so the lines the plugin writes are
 * the lines the editor would produce for the same text, font and width.
 *
 * The provider is global in the editor module (one per thread), so a wrapper
 * installs its table on construction; inside the worker there is one.
 */
/* eslint-disable no-restricted-imports, import/no-restricted-paths -- the editor's own wrapText is bundled by esbuild so line breaks match the editor exactly (PHASE4-PLAN, E1); the shim keeps the rest of the editor out of the bundle. */
import {
  charWidth,
  setCustomTextMetricsProvider,
} from "../../../../../packages/element/src/textMeasurements";
import { getWrappedTextLines } from "../../../../../packages/element/src/textWrapping";

import { fontKey } from "./fonts";
import { createMeasurers } from "./widthTable";

import type { FontString } from "../../../../../packages/element/src/types";
import type { Role } from "./fonts";
import type { LineMeasurer, WidthTable } from "./widthTable";

export class Wrapper {
  private readonly measurers: Map<string, LineMeasurer>;
  /** Font strings handed to `wrapText`, one per role, cached. */
  private readonly keys = new Map<Role, FontString>();

  constructor(table: WidthTable) {
    this.measurers = createMeasurers(table);
    const measurers = this.measurers;
    setCustomTextMetricsProvider({
      getLineWidth(text, fontString) {
        const m = measurers.get(fontString);
        if (!m) {
          throw new Error(`No width table for font "${fontString}"`);
        }
        return m.width(text);
      },
    });
    // The editor caches single-character widths per font string across
    // calls; a previous table in this thread must not leak into this one.
    for (const key of measurers.keys()) {
      charWidth.clearCache(key as FontString);
    }
  }

  font(role: Role): FontString {
    let key = this.keys.get(role);
    if (!key) {
      key = fontKey(role.family, role.size) as FontString;
      this.keys.set(role, key);
    }
    return key;
  }

  /** True when the role's font was measured. */
  has(role: Role): boolean {
    return this.measurers.has(fontKey(role.family, role.size));
  }

  /** The width of a string on one line, from the table. */
  width(text: string, role: Role): number {
    const m = this.measurers.get(fontKey(role.family, role.size));
    return m ? m.width(text) : 0;
  }

  /** The text's lines after wrapping at `maxWidth` (hard breaks kept). */
  lines(text: string, role: Role, maxWidth: number): string[] {
    const wrapped = getWrappedTextLines(text, this.font(role), maxWidth);
    const out = new Array<string>(wrapped.length);
    for (let i = 0; i < wrapped.length; i++) {
      out[i] = wrapped[i].text;
    }
    return out;
  }
}
