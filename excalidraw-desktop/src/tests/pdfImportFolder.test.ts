/**
 * The PDF import lives in the official plugin (plugins/official/pdf-import). `src/pdfImport/` keeps
 * only the settings the config, Settings and Files page share: no second copy of the importer.
 * Every file in it must be imported by something outside the folder.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const DIR = join(SRC, "pdfImport");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe("src/pdfImport", () => {
  const files = walk(DIR);
  const others = walk(SRC).filter(
    (f) => /\.tsx?$/.test(f) && !f.startsWith(DIR) && !f.endsWith("pdfImportFolder.test.ts"),
  );

  it("holds no importer code, only settings", () => {
    expect(files.map((f) => f.slice(DIR.length + 1)).sort()).toEqual([
      "PdfImportSettings.tsx",
      "types.ts",
    ]);
  });

  it.each(files.map((f) => f.slice(DIR.length + 1)))("%s is imported from outside the folder", (name) => {
    const stem = name.replace(/\.tsx?$/, "");
    const re = new RegExp(`pdfImport/${stem}["']`);
    expect(others.some((f) => re.test(readFileSync(f, "utf8")))).toBe(true);
  });
});
