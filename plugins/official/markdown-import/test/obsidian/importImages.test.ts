/**
 * Image forms in an Obsidian vault import (synthetic vault): relative paths from the note's folder,
 * names with spaces and non-ASCII letters, an attachments folder, every supported type, fragments,
 * the 4 MiB cap, unsupported types and remote images.
 */
import { describe, expect, test } from "vitest";

import { fakeParseMarkdown } from "../../../../../sdk/api/shared/markdown";
import { buildWidthTable, layoutNote } from "../../src/layout/index";
import {
  importObsidianVault,
  MAX_EMBED_BYTES,
} from "../../src/obsidian/importVault";
import { defaultOptions, fakeMeasure } from "../layout/fixtures";

import type { NoteDoc, SourceFolder, TargetFolder } from "@vaultdraw/api";
import type { PageItem } from "../../src/layout/types";
import type { ImportSettings } from "../../src/settings";

const settings: ImportSettings = {
  font: "default",
  fontSize: 16,
  pageSize: "a4",
  partElements: 1000,
  obsidianAttachments: true,
  obsidianLinks: "drawing",
  obsidianExcalidraw: true,
};

/** Each note line `IMG <target>` is an image block. */
const parse = (text: string): NoteDoc => {
  const blocks = text.split("\n").map((line, i) => {
    const m = /^IMG (.+)$/.exec(line);
    return m
      ? ({
          kind: "image",
          target: m[1],
          remote: /^https?:/.test(m[1]),
          range: [i, i],
        } as never)
      : ({ kind: "paragraph", text: line, range: [i, i] } as never);
  });
  return { ...fakeParseMarkdown(""), blocks };
};

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A PNG-looking file of `n` bytes; the byte after the signature is `n`. */
const pngOf = (n: number) => {
  const b = new Uint8Array(Math.max(n, 9)).fill(n);
  b.set(PNG);
  return b;
};
const bytesOf = pngOf;

const source = (
  files: Record<string, string | number | Uint8Array>,
): SourceFolder => {
  const data = new Map(
    Object.entries(files).map(([p, v]) => [
      p,
      typeof v === "string"
        ? new TextEncoder().encode(v)
        : typeof v === "number"
        ? bytesOf(v)
        : v,
    ]),
  );
  return {
    name: "v",
    async list() {
      return [...data].map(([path, b]) => ({
        path,
        size: b.length,
        modifiedAt: 1,
      }));
    },
    async readText(p) {
      return new TextDecoder().decode(data.get(p)!);
    },
    async readBytes(p) {
      return data.get(p)!;
    },
  };
};

const run = async (files: Record<string, string | number | Uint8Array>) => {
  const written = new Map<string, PageItem[]>();
  const target = {
    name: "out",
    kind: "newVault",
    async writeDrawing(p: string, scene: { items: PageItem[] }) {
      written.set(p, scene.items);
    },
    async copyFrom() {},
    async convertDrawing() {},
    async open() {},
  } as unknown as TargetFolder;
  const r = await importObsidianVault({
    ctx: {
      markdown: { parse: async (t: string) => parse(t) },
      pages: {
        geometry: () => ({ width: 794, height: 1123 } as never),
        buildScene: async (items: readonly PageItem[]) => ({ items }),
      },
    } as never,
    source: source(files),
    target,
    settings,
    signal: new AbortController().signal,
    onProgress: () => {},
    layout: async (doc) => {
      const opts = defaultOptions();
      return layoutNote(doc, buildWidthTable(fakeMeasure, doc, opts), opts)
        .parts;
    },
  });
  const embedded = (note: string) =>
    (written.get(note) ?? []).flatMap((i) => (i.type === "image" ? [i] : []));
  return { r, embedded };
};

describe("image forms in an import", () => {
  test("relative, spaced, non-ASCII, attachments-folder and fragment forms all get their bytes", async () => {
    const note = [
      "IMG a.png", // vault-wide name
      "IMG ./sub/b.png", // ./ from the note's folder
      "IMG ../shared/c.webp", // ../ from the note's folder
      "IMG my pics/d e.gif", // spaces
      "IMG Ünï/f.svg", // non-ASCII
      "IMG 00 - Attachments/Pasted/g.png", // full path
      "IMG g.png", // bare name in the attachments folder
      "IMG a.png#size", // fragment
    ].join("\n");
    const { r, embedded } = await run({
      "n/Note.md": note,
      "n/sub/b.png": 10,
      "shared/c.webp": 10,
      "my pics/d e.gif": 10,
      "Ünï/f.svg": 10,
      "00 - Attachments/Pasted/g.png": 10,
      "a.png": 10,
    });
    const imgs = embedded("n/Note.excalidraw");
    expect(imgs).toHaveLength(8);
    expect(imgs.filter((i) => i.bytes)).toHaveLength(8);
    expect(r.missingImages).toBe(0);
  });

  test("a note's own folder wins over a same-named file elsewhere", async () => {
    const files = {
      "a/Note.md": "IMG pic.png",
      "a/pic.png": 20,
      "b/pic.png": 30,
    };
    const { embedded } = await run(files);
    expect(embedded("a/Note.excalidraw")[0].bytes).toHaveLength(20);
  });

  test("over the cap, unsupported and remote images are counted, not embedded", async () => {
    const { r, embedded } = await run({
      "Note.md":
        "IMG big.png\nIMG x.avif\nIMG https://example.com/r.png\nIMG gone.png",
      "big.png": MAX_EMBED_BYTES + 1,
      "x.avif": 10,
    });
    expect(embedded("Note.excalidraw").filter((i) => i.bytes)).toHaveLength(0);
    expect(r).toMatchObject({
      oversizedImages: 1,
      unsupportedImages: 1,
      missingImages: 1,
    });
  });
});

describe("a picture is judged by its bytes, not its name", () => {
  test("a WebP named .png is embedded as image/webp; a text file named .png stays a labelled box", async () => {
    const webp = new Uint8Array(20);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const files = {
      "Note.md": "IMG a.png\nIMG b.png\nIMG c.png",
      "a.png": webp,
      "b.png": 10,
      "c.png": new TextEncoder().encode("not a picture at all"),
    };
    const { r, embedded } = await run(files);
    const imgs = embedded("Note.excalidraw");
    expect(imgs[0].mimeType).toBe("image/webp");
    expect(imgs[0].bytes).toBeDefined();
    expect(imgs[1].mimeType).toBe("image/png");
    expect(imgs[2].bytes).toBeUndefined();
    expect(imgs[2].alt).toMatch(/Not a picture/);
    expect(r.unsupportedImages).toBe(1);
  });
});
