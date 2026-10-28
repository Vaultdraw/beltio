/**
 * Family: every way a note references a file resolves like Obsidian does (toimprove 68).
 * A generated vault per "Files & links → Default location for new attachments" setting
 * (same folder as the note, a subfolder, the vault folder, a named folder), each with the same list
 * of reference forms. The parser is the real Rust one in the app; here each form is given as the
 * block the parser produces for it (see vaultdraw-core markdown/tests.rs `image_forms`).
 */
import { describe, expect, test } from "vitest";

import { fakeParseMarkdown } from "../../../../../sdk/api/shared/markdown";
import { buildWidthTable, layoutNote } from "../../src/layout/index";
import { importObsidianVault } from "../../src/obsidian/importVault";
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
  obsidianReport: true,
} as ImportSettings;

/** A note body line: `IMG target`, `IMG|alt|w target`, `PARA text` (text the parser keeps literal), `HTML <img…>`. */
const parse = (text: string): NoteDoc => {
  const blocks = text.split("\n").map((line, i) => {
    const range = [i, i];
    const img = /^IMG (.+)$/.exec(line);
    if (img) {
      return {
        kind: "image",
        target: img[1],
        remote: /^https?:/i.test(img[1]),
        range,
      };
    }
    const html = /^HTML (.+)$/.exec(line);
    if (html) {
      return { kind: "html", text: html[1], range };
    }
    return { kind: "paragraph", text: line.replace(/^PARA /, ""), range };
  });
  return { ...fakeParseMarkdown(""), blocks } as unknown as NoteDoc;
};

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A PNG-looking file of `n` bytes; the byte after the signature is `n`. */
const pngOf = (n: number) => {
  const b = new Uint8Array(Math.max(n, 9)).fill(n);
  b.set(PNG);
  return b;
};

const run = async (
  files: Record<string, number>,
  over: Partial<ImportSettings> = {},
) => {
  const data = new Map(
    Object.entries(files).map(([p, n]) => [
      p,
      p.endsWith(".md") ? new TextEncoder().encode(String(n)) : pngOf(n),
    ]),
  );
  const notes = new Map<string, string>();
  const src: SourceFolder = {
    name: "v",
    async list() {
      return [...data].map(([path, b]) => ({
        path,
        size: b.length,
        modifiedAt: 1,
      }));
    },
    async readText(p) {
      return notes.get(p) ?? "";
    },
    async readBytes(p) {
      return data.get(p)!;
    },
  };
  return { src, notes };
};

/** Every case: the reference, the note's folder, where the file really is (null: nowhere). */
interface Case {
  name: string;
  note: string;
  ref: string;
  file: string | null;
  /** The size byte of the file the picture must come from. */
  expectSize?: number;
}

const SIZE = 11;
const DECOY = 99;
const CASES: Case[] = [
  {
    name: "![[name.png]] from anywhere in the vault",
    note: "Notes/A.md",
    ref: "IMG pic.png",
    file: "Deep/Down/pic.png",
  },
  {
    name: "![[name.png|300]] (size is not part of the name)",
    note: "Notes/A.md",
    ref: "IMG pic.png",
    file: "Assets/pic.png",
  },
  {
    name: "![[sub/name.png]] partial path",
    note: "Notes/A.md",
    ref: "IMG Assets/pic.png",
    file: "Vault/Assets/pic.png",
  },
  {
    name: "![](rel/path.png) from the note's folder",
    note: "Notes/A.md",
    ref: "IMG rel/path.png",
    file: "Notes/rel/path.png",
  },
  {
    name: "![](./path.png)",
    note: "Notes/A.md",
    ref: "IMG ./path.png",
    file: "Notes/path.png",
  },
  {
    name: "![](../path.png)",
    note: "Notes/A.md",
    ref: "IMG ../path.png",
    file: "path.png",
  },
  {
    name: "![](../../Assets/path.png) up two levels",
    note: "Notes/Deep/A.md",
    ref: "IMG ../../Assets/path.png",
    file: "Assets/path.png",
  },
  {
    name: "![](../../../x.png) above the vault falls back to the name",
    note: "Notes/A.md",
    ref: "IMG ../../../x.png",
    file: "Assets/x.png",
  },
  {
    name: "![](/Assets/path.png) vault-root path",
    note: "Notes/A.md",
    ref: "IMG /Assets/path.png",
    file: "Assets/path.png",
  },
  {
    name: "spaces (decoded %20) in the name",
    note: "Notes/A.md",
    ref: "IMG my pics/a b.png",
    file: "Notes/my pics/a b.png",
  },
  {
    name: "case differences",
    note: "Notes/A.md",
    ref: "IMG ASSETS/PIC.PNG",
    file: "Assets/pic.png",
  },
  {
    name: "unicode, composed vs decomposed",
    note: "Notes/A.md",
    ref: "IMG Café.png",
    file: "Café.png",
  },
  {
    name: "double spaces in the file name",
    note: "Notes/A.md",
    ref: "IMG a b.png",
    file: "a  b.png",
  },
  {
    name: "query or fragment after the name",
    note: "Notes/A.md",
    ref: "IMG pic.png?raw=1",
    file: "pic.png",
  },
  {
    name: "two files of one name: the one beside the note wins",
    note: "Notes/A.md",
    ref: "IMG pic.png",
    file: "Notes/pic.png",
    expectSize: SIZE,
  },
  {
    name: "Pasted image names with timestamps",
    note: "Notes/A.md",
    ref: "IMG Pasted image 20240101120000.png",
    file: "attachments/Pasted image 20240101120000.png",
  },
  {
    name: "every supported type: jpg",
    note: "Notes/A.md",
    ref: "IMG photo.JPG",
    file: "photo.jpg",
  },
  {
    name: "every supported type: webp",
    note: "Notes/A.md",
    ref: "IMG p.webp",
    file: "x/p.webp",
  },
  {
    name: "every supported type: svg",
    note: "Notes/A.md",
    ref: "IMG p.svg",
    file: "x/p.svg",
  },
  {
    name: "every supported type: gif",
    note: "Notes/A.md",
    ref: "IMG p.gif",
    file: "x/p.gif",
  },
  {
    name: "a name that really is missing",
    note: "Notes/A.md",
    ref: "IMG nope.png",
    file: null,
  },
  {
    name: "![alt](path with spaces.png): the parser leaves it as text",
    note: "Notes/A.md",
    ref: "PARA ![alt](my pics/a b.png)",
    file: "Notes/my pics/a b.png",
  },
  {
    name: "![alt](<path with spaces.png>) angle brackets",
    note: "Notes/A.md",
    ref: "PARA ![alt|200](<my pics/a b.png>)",
    file: "Notes/my pics/a b.png",
  },
  {
    name: '<img src="..."> raw HTML',
    note: "Notes/A.md",
    ref: 'HTML <img src="my%20pics/a%20b.png" width="200">',
    file: "Notes/my pics/a b.png",
  },
];

/** The "new attachments" settings of Obsidian, each with where it puts a file for `Notes/A.md`. */
const SETTINGS = [
  { id: "vault folder (/)", app: { attachmentFolderPath: "/" } },
  { id: "same folder (./)", app: { attachmentFolderPath: "./" } },
  {
    id: "subfolder (./attachments)",
    app: { attachmentFolderPath: "./attachments" },
  },
  { id: "named folder (Assets)", app: { attachmentFolderPath: "Assets" } },
];

describe("every way a note references an image resolves like Obsidian", () => {
  for (const s of SETTINGS) {
    describe(`Obsidian setting: ${s.id}`, () => {
      for (const c of CASES) {
        test(c.name, async () => {
          const files: Record<string, number> = {
            [c.note]: 1,
            ".obsidian/app.json": 2,
          };
          if (c.file) {
            files[c.file] = c.expectSize ?? SIZE;
          }
          if (c.expectSize) {
            files["Other/pic.png"] = DECOY; // a decoy elsewhere
          }
          const { src, notes } = await run(files);
          notes.set(c.note, c.ref);
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
            source: src,
            target,
            settings,
            signal: new AbortController().signal,
            onProgress: () => {},
            layout: async (doc) => {
              const o = defaultOptions();
              return layoutNote(doc, buildWidthTable(fakeMeasure, doc, o), o)
                .parts;
            },
          });
          const imgs = (
            written.get(c.note.replace(/\.md$/, ".excalidraw")) ?? []
          ).filter(
            (i): i is PageItem & { type: "image" } => i.type === "image",
          );
          expect(imgs).toHaveLength(1);
          if (c.file) {
            expect(imgs[0].bytes, `bytes of ${c.ref}`).toBeDefined();
            expect(imgs[0].bytes![8]).toBe(c.expectSize ?? SIZE);
            expect(r.missingImages).toBe(0);
          } else {
            expect(imgs[0].bytes).toBeUndefined();
            expect(imgs[0].alt).toMatch(/not found/);
            expect(r.missingImages).toBe(1);
          }
        });
      }
    });
  }

  test("images still resolve when copying attachments is switched off", async () => {
    const files = { "N.md": 1, "a/pic.png": SIZE };
    const { src, notes } = await run(files);
    notes.set("N.md", "IMG pic.png");
    const written = new Map<string, PageItem[]>();
    await importObsidianVault({
      ctx: {
        markdown: { parse: async (t: string) => parse(t) },
        pages: {
          geometry: () => ({ width: 794, height: 1123 } as never),
          buildScene: async (items: readonly PageItem[]) => ({ items }),
        },
      } as never,
      source: src,
      target: {
        name: "out",
        kind: "newVault",
        async writeDrawing(p: string, scene: { items: PageItem[] }) {
          written.set(p, scene.items);
        },
        async copyFrom() {},
        async convertDrawing() {},
        async open() {},
      } as unknown as TargetFolder,
      settings: { ...settings, obsidianAttachments: false },
      signal: new AbortController().signal,
      onProgress: () => {},
      layout: async (doc) => {
        const o = defaultOptions();
        return layoutNote(doc, buildWidthTable(fakeMeasure, doc, o), o).parts;
      },
    });
    const img = written
      .get("N.excalidraw")!
      .find((i) => i.type === "image") as any;
    expect(img.bytes).toBeDefined();
  });
});

describe("embeds of notes resolve to the converted drawing", () => {
  test("![[Note]] points at the drawing's path, an unknown one stays as written", async () => {
    const { rewriteLinks, LinkResolver } = await import(
      "../../src/obsidian/links"
    );
    const { planImport } = await import("../../src/obsidian/plan");
    const plan = planImport(
      [{ path: "Deep/Other Note.md", size: 1, modifiedAt: 1 }],
      { obsidianAttachments: true, obsidianExcalidraw: true },
    );
    const doc = {
      ...fakeParseMarkdown(""),
      blocks: [
        { kind: "embed", target: "other note", heading: "H", range: [0, 0] },
        { kind: "embed", target: "ghost", range: [0, 0] },
      ],
    } as unknown as NoteDoc;
    const out = rewriteLinks(doc, new LinkResolver(plan.items)).doc
      .blocks as any[];
    expect(out[0].target).toBe("Deep/Other Note");
    expect(out[1].target).toBe("ghost");
  });
});
