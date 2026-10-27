/** The import report: written only when something went wrong, listing files and images by reason. */
import { describe, expect, test } from "vitest";

import { fakeParseMarkdown } from "../../../../../sdk/api/shared/markdown";
import { buildWidthTable, layoutNote } from "../../src/layout/index";
import { importObsidianVault } from "../../src/obsidian/importVault";
import { buildReport } from "../../src/obsidian/report";
import { defaultOptions, fakeMeasure } from "../layout/fixtures";

import type { NoteDoc, SourceFolder, TargetFolder } from "@vaultdraw/api";
import type { ImportSettings } from "../../src/settings";

const settings: ImportSettings = {
  font: "default",
  fontSize: 16,
  pageSize: "a4",
  partElements: 1000,
  obsidianAttachments: true,
  obsidianLinks: "drawing",
  obsidianExcalidraw: true,
  obsidianReport: true,
};

/** `IMG <target>` lines are images; `PAR <text>` paragraphs. */
const parse = (text: string): NoteDoc => {
  if (text === "BOOM") {
    throw new Error("cannot parse this note");
  }
  const blocks = text.split("\n").map((line, i) => {
    const m = /^IMG (.+)$/.exec(line);
    return m
      ? ({ kind: "image", target: m[1], remote: false, range: [i, i] } as never)
      : ({ kind: "paragraph", text: line, range: [i, i] } as never);
  });
  return { ...fakeParseMarkdown(""), blocks };
};

const run = async (files: Record<string, string | number>, on = true) => {
  const data = new Map(
    Object.entries(files).map(([p, v]) => [
      p,
      typeof v === "string"
        ? new TextEncoder().encode(v)
        : new Uint8Array(v).fill(7),
    ]),
  );
  const source: SourceFolder = {
    name: "v",
    list: async () =>
      [...data].map(([path, b]) => ({ path, size: b.length, modifiedAt: 1 })),
    readText: async (p) => new TextDecoder().decode(data.get(p)!),
    readBytes: async (p) => data.get(p)!,
  };
  const written: string[] = [];
  const target = {
    name: "out",
    kind: "newVault",
    async writeDrawing(p: string) {
      written.push(p);
    },
    async copyFrom() {},
    async convertDrawing() {},
    async open() {},
  } as unknown as TargetFolder;
  const texts: string[] = [];
  const r = await importObsidianVault({
    ctx: {
      markdown: {
        parse: async (t: string) => {
          texts.push(t);
          return parse(t);
        },
      },
      pages: {
        geometry: () => ({ width: 794, height: 1123 } as never),
        buildScene: async () => ({}),
      },
    } as never,
    source,
    target,
    settings: { ...settings, obsidianReport: on },
    signal: new AbortController().signal,
    onProgress: () => {},
    layout: async (doc) => {
      const opts = defaultOptions();
      return layoutNote(doc, buildWidthTable(fakeMeasure, doc, opts), opts)
        .parts;
    },
  });
  return { r, written, texts };
};

describe("import report", () => {
  test("a clean import writes none", async () => {
    const { r, written } = await run({ "A.md": "hello" });
    expect(r.report).toBeUndefined();
    expect(written).toEqual(["A.excalidraw"]);
  });

  test("failed files and image problems are listed by reason, and the report is written", async () => {
    const { r, written, texts } = await run({
      "Bad.md": "BOOM",
      "N.md": "IMG gone.png\nIMG big.png\nIMG x.avif",
      "big.png": 5 * 1024 * 1024,
      "x.avif": 10,
    });
    expect(r.errors.map((e) => e.path)).toEqual(["Bad.md"]);
    expect(r.report).toBe("Import report.excalidraw");
    expect(written).toContain("Import report.excalidraw");
    const md = texts.at(-1)!;
    expect(md).toContain("## Files that failed (1)");
    expect(md).toContain("`Bad.md`: cannot parse this note");
    expect(md).toContain("## Image file not found in the vault (1)");
    expect(md).toContain("`N.md`: `gone.png`");
    expect(md).toContain("## Image over 4 MB");
    expect(md).toContain("`N.md`: `big.png`");
    expect(md).toContain("## Image type a drawing cannot hold");
  });

  test("the setting turns it off", async () => {
    const { r, written } = await run({ "Bad.md": "BOOM" }, false);
    expect(r.report).toBeUndefined();
    expect(written).not.toContain("Import report.excalidraw");
  });

  test("buildReport mentions images beyond the listed rows", () => {
    const md = buildReport("v", {
      notes: 1,
      drawings: 1,
      attachments: 0,
      skipped: 0,
      unresolvedLinks: 0,
      missingImages: 3,
      oversizedImages: 0,
      unsupportedImages: 0,
      imageIssues: [{ note: "a.md", image: "p.png", reason: "missing" }],
      errors: [],
      cancelled: false,
      written: [],
      ms: 1,
    });
    expect(md).toContain("2 more images are not listed.");
  });
});
