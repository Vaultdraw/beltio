import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guard (hunter A-5, 2026-10-30): bold text is its family's bold variant (id + 100). Code that
 * compares a text's `fontFamily` to a fixed family, or looks its name up by the raw id, misses
 * every bold text (the theme/font update, the font picker and the plugin scene read all did).
 * Compare `regularFontOf(x.fontFamily)` instead, or add `// bold-ok: <why>` on the line above.
 */
const ROOT = resolve(__dirname, "../../..");
const PATTERNS = [
  // x.fontFamily === 5 / FONT_FAMILY.X / SOME_FONT
  /\.fontFamily\s*[!=]==\s*(?:\d|FONT_FAMILY\b|[A-Z][A-Z_]+\b)/,
  /(?:\d|FONT_FAMILY\.\w+|\b[A-Z][A-Z_]+)\s*[!=]==\s*\w+\.fontFamily\b/,
  // FONT_NAME.get(el.fontFamily), FONT_METADATA[el.fontFamily]
  /(?:FONT_NAME\.get\(|FONT_METADATA\[)\s*\w+\.fontFamily\s*[)\]]/,
];

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist"].includes(name) || name.startsWith(".")) {
      continue;
    }
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path, out);
    } else if (
      /\.tsx?$/.test(name) &&
      !/\.(test|spec|bench)\.tsx?$/.test(name)
    ) {
      out.push(path);
    }
  }
  return out;
};

describe("bold font guard", () => {
  it("no code compares a text's font to a fixed family by its raw id", () => {
    const files = [
      ...walk(join(ROOT, "excalidraw-desktop/src")),
      ...walk(join(ROOT, "plugins/official")),
      ...walk(join(ROOT, "sdk/api")),
    ].filter((f) => !/\/test\//.test(f));
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (
          /^\s*(\/\/|\*)/.test(line) ||
          !PATTERNS.some((p) => p.test(line)) ||
          /bold-ok/.test(lines[i - 1] ?? "")
        ) {
          return;
        }
        offenders.push(`${f.slice(ROOT.length + 1)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the patterns catch the bugs they were written for", () => {
    for (const line of [
      "e.fontFamily === OLD_IMPORT_FONT,",
      "if (el.fontFamily === 5) {",
      "out.fontFamily = FONT_NAME.get(el.fontFamily) ?? x;",
      "FONT_FAMILY.Cascadia === el.fontFamily",
    ]) {
      expect(
        PATTERNS.some((p) => p.test(line)),
        line,
      ).toBe(true);
    }
  });
});
