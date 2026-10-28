/**
 * The Obsidian vault import against a fixture vault on disk: a golden of the written tree,
 * the source left byte-identical, create-only writes, cancel and per-file errors.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { fakeExtractScene } from "../../../../../sdk/api/shared/fakeFolders";
import { fakeParseMarkdown } from "../../../../../sdk/api/shared/markdown";
import {
  COPY_CONCURRENCY,
  importObsidianVault,
} from "../../src/obsidian/importVault";
import { buildWidthTable, layoutNote } from "../../src/layout/index";
import { defaultOptions, fakeMeasure } from "../layout/fixtures";

import type { NoteDoc, SourceFolder, TargetFolder } from "@vaultdraw/api";
import type { PageItem } from "../../src/layout/types";
import type { ImportSettings } from "../../src/settings";
import type {
  NoteLayout,
  ObsidianImportOptions,
} from "../../src/obsidian/types";

const VAULT = path.join(__dirname, "../fixtures/obsidian-vault");

const settings: ImportSettings = {
  font: "default",
  fontSize: 16,
  pageSize: "a4",
  partElements: 1000,
  obsidianAttachments: true,
  obsidianLinks: "drawing",
  obsidianExcalidraw: true,
};

/** Every file under `dir` (dot entries too), relative "/" paths, sorted. */
const walk = (dir: string, base = dir): string[] =>
  readdirSync(dir)
    .sort()
    .flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory()
        ? walk(p, base)
        : [path.relative(base, p).split(path.sep).join("/")];
    });

const treeHash = (dir: string): string => {
  const h = createHash("sha256");
  for (const rel of walk(dir)) {
    h.update(rel)
      .update("\0")
      .update(readFileSync(path.join(dir, rel)));
  }
  return h.digest("hex");
};

/** The fixture on disk plus decoys a repository cannot hold (a nested .git). */
const diskSource = (): SourceFolder & { reads: string[] } => {
  const files = new Map<string, Uint8Array>();
  for (const rel of walk(VAULT)) {
    files.set(rel, readFileSync(path.join(VAULT, rel)));
  }
  files.set(".git/config", new Uint8Array([1]));
  const reads: string[] = [];
  return {
    name: "obsidian-vault",
    reads,
    async list() {
      return [...files].map(([p, b]) => ({
        path: p,
        size: b.length,
        modifiedAt: 1,
      }));
    },
    async readText(p) {
      reads.push(p);
      return new TextDecoder().decode(files.get(p)!);
    },
    async readBytes(p) {
      reads.push(p);
      return files.get(p)!;
    },
  };
};

/** An in-memory create-only target with the rows' behaviour (NAME_COLLISION, INVALID_FILE). */
const memoryTarget = (preset: string[] = []) => {
  const files = new Map<string, object | Uint8Array>(
    preset.map((p) => [p, new Uint8Array()]),
  );
  const taken = (p: string) =>
    [...files.keys()].some((k) => k.toLowerCase() === p.toLowerCase());
  const put = (p: string, v: object | Uint8Array) => {
    if (taken(p)) {
      throw Object.assign(new Error(`Already exists: ${p}`), {
        code: "NAME_COLLISION",
      });
    }
    files.set(p, v);
  };
  const target: TargetFolder = {
    name: "out",
    kind: "newVault",
    async writeDrawing(p, scene) {
      put(p, scene);
    },
    async copyFrom(src, from, to) {
      put(to, await src.readBytes(from));
    },
    async convertDrawing(src, from, to) {
      put(to, fakeExtractScene(await src.readText(from)));
    },
    async open() {},
  };
  return { target, files };
};

/** The real layout over the fake measure; the fake parser (with wikilink spans) plus `![[x]]` image blocks. */
const parse = (text: string): NoteDoc => {
  const doc = fakeParseMarkdown(text);
  const blocks = doc.blocks.map((b) => {
    const m = b.kind === "paragraph" && /^!\[\[([^\]|]+)\]\]$/.exec(b.text);
    return m
      ? ({
          kind: "image",
          target: m[1],
          remote: false,
          range: b.range,
        } as never)
      : b;
  });
  return { ...doc, blocks };
};

const layout: NoteLayout = async (doc) => {
  const opts = defaultOptions();
  return layoutNote(doc, buildWidthTable(fakeMeasure, doc, opts), opts).parts;
};

const ctx = {
  markdown: { parse: async (t: string) => parse(t) },
  pages: {
    geometry: () => ({ width: 794, height: 1123 } as never),
    buildScene: async (
      items: readonly PageItem[],
      o: { pageCount: number },
    ) => ({
      type: "excalidraw",
      pages: o.pageCount,
      items,
    }),
  },
};

const run = (over: Partial<ObsidianImportOptions> = {}) => {
  const source = diskSource();
  const out = memoryTarget();
  const progress: [number, number, string][] = [];
  const options: ObsidianImportOptions = {
    ctx,
    source,
    target: out.target,
    settings,
    signal: new AbortController().signal,
    onProgress: (d, t, c) => progress.push([d, t, c]),
    layout,
    ...over,
  };
  return { source, out, progress, go: () => importObsidianVault(options) };
};

const linkTexts = (scene: object): string[] =>
  (scene as { items: PageItem[] }).items.flatMap((i) =>
    i.type === "text" ? [i.text] : [],
  );

describe("importObsidianVault", () => {
  test("converts the fixture vault; the golden of the written tree", async () => {
    const before = treeHash(VAULT);
    const { out, go } = run();
    const r = await go();
    expect(treeHash(VAULT), "the source is byte-identical").toBe(before);
    expect([...out.files.keys()]).toEqual([
      "Empty.excalidraw",
      "Home.excalidraw",
      "Projects/Alpha/Plan.excalidraw",
      "Drawings/Old.excalidraw",
      "Drawings/Sketch.excalidraw",
      "attachments/doc.pdf",
      "attachments/pic.png",
    ]);
    expect(r).toMatchObject({
      notes: 3,
      drawings: 5,
      attachments: 2,
      skipped: 3, // .obsidian/app.json, .trash/Old.md, .git/config
      unresolvedLinks: 1, // [[Missing]]
      missingImages: 1,
      cancelled: false,
      first: "Empty.excalidraw",
    });
    expect(r.errors).toEqual([
      expect.objectContaining({ path: "Drawings/Broken.excalidraw.md" }),
    ]);
  });

  test("links are rewritten to the converted drawings; unresolved ones stay text", async () => {
    const { out, go } = run();
    await go();
    const home = linkTexts(out.files.get("Home.excalidraw") as object).join(
      "\n",
    );
    expect(home).toContain("[[Projects/Alpha/Plan]]");
    expect(home).toContain("[[Projects/Alpha/Plan|the plan]]");
    expect(home).toContain("[[Drawings/Sketch|Sketch]]");
    expect(home).toContain("[[Missing]]");
    const plan = linkTexts(
      out.files.get("Projects/Alpha/Plan.excalidraw") as object,
    ).join("\n");
    expect(plan).toContain("[[Home|home]]");
  });

  test("an embedded image gets its bytes; a missing one is counted", async () => {
    const { out, source, go } = run();
    const r = await go();
    const items = (
      out.files.get("Projects/Alpha/Plan.excalidraw") as { items: PageItem[] }
    ).items;
    const images = items.filter((i) => i.type === "image");
    expect(images).toHaveLength(2);
    expect(images.filter((i) => i.type === "image" && i.bytes).length).toBe(1);
    expect(r.missingImages).toBe(1);
    expect(source.reads).toContain("attachments/pic.png");
  });

  test("obsidianLinks = text keeps the links as written", async () => {
    const { out, go } = run({
      settings: { ...settings, obsidianLinks: "text" },
    });
    await go();
    const home = linkTexts(out.files.get("Home.excalidraw") as object).join(
      "\n",
    );
    expect(home).toContain("[[Plan|the plan]]");
    expect(home).not.toContain("[[Projects/Alpha/Plan|the plan]]");
  });

  test("settings turn attachments and Excalidraw files off", async () => {
    const { out, go } = run({
      settings: {
        ...settings,
        obsidianAttachments: false,
        obsidianExcalidraw: false,
      },
    });
    const r = await go();
    expect([...out.files.keys()]).toEqual([
      "Empty.excalidraw",
      "Home.excalidraw",
      "Projects/Alpha/Plan.excalidraw",
      "Drawings/Old.excalidraw",
    ]);
    expect(r.errors).toEqual([]);
    expect(r.attachments).toBe(0);
  });

  test("never overwrites: a name that exists gets the next free name", async () => {
    const source = diskSource();
    const out = memoryTarget(["Home.excalidraw"]);
    const r = await importObsidianVault({
      ctx,
      source,
      target: out.target,
      settings,
      signal: new AbortController().signal,
      onProgress() {},
      layout,
    });
    expect(out.files.get("Home.excalidraw")).toEqual(new Uint8Array());
    expect(out.files.has("Home 2.excalidraw")).toBe(true);
    expect(r.written).toContain("Home 2.excalidraw");
  });

  test("an earlier import in the folder: the whole import moves to a fresh folder, so links resolve inside it", async () => {
    const source = diskSource();
    const first = memoryTarget(["Empty.excalidraw"]);
    const fresh = memoryTarget();
    const asked: number[] = [];
    const r = await importObsidianVault({
      ctx,
      source,
      target: first.target,
      settings,
      signal: new AbortController().signal,
      onProgress() {},
      layout,
      nextTarget: async (attempt) => {
        asked.push(attempt);
        return fresh.target;
      },
    });
    expect(asked).toEqual([2]);
    expect(r.target).toBe(fresh.target);
    expect([...first.files.keys()]).toEqual(["Empty.excalidraw"]);
    expect(fresh.files.has("Home.excalidraw")).toBe(true);
    expect(fresh.files.has("Empty 2.excalidraw")).toBe(false);
    expect(r.errors.map((e) => e.path)).toEqual([
      "Drawings/Broken.excalidraw.md",
    ]);
  });

  test("cancel stops before the next file and keeps what was written", async () => {
    const ac = new AbortController();
    const { out, go } = run({
      signal: ac.signal,
      onProgress: (done) => {
        if (done === 2) {
          ac.abort("cancel");
        }
      },
    });
    const r = await go();
    expect(r.cancelled).toBe(true);
    expect([...out.files.keys()]).toEqual([
      "Empty.excalidraw",
      "Home.excalidraw",
    ]);
  });

  test("a long note becomes parts, each its own drawing", async () => {
    const parts: NoteLayout = async () => [
      { items: [], pageCount: 1 },
      { items: [], pageCount: 2 },
      { items: [], pageCount: 1 },
    ];
    const { out, go } = run({ layout: parts });
    await go();
    expect(out.files.has("Home.excalidraw")).toBe(true);
    expect(out.files.has("Home (part 2).excalidraw")).toBe(true);
    expect(out.files.has("Home (part 3).excalidraw")).toBe(true);
    expect(
      (out.files.get("Home (part 2).excalidraw") as { pages: number }).pages,
    ).toBe(2);
  });

  test("progress is reported before each file and ends at the total", async () => {
    const { progress, go } = run();
    await go();
    expect(progress[0]).toEqual([0, 8, "Empty.md"]);
    expect(progress.at(-1)).toEqual([8, 8, ""]);
  });

  describe("a large vault", () => {
    /** 40 attachments and 6 notes in a source that answers after a short delay. */
    const bigRun = (over: Partial<ObsidianImportOptions> = {}) => {
      const files = new Map<string, string>();
      for (let i = 0; i < 6; i++) {
        files.set(`n${i}.md`, `# Note ${i}\n\nbody`);
      }
      for (let i = 0; i < 40; i++) {
        files.set(`a/f${String(i).padStart(2, "0")}.bin`, "x");
      }
      const source: SourceFolder = {
        name: "big",
        async list() {
          return [...files].map(([p, t]) => ({
            path: p,
            size: t.length,
            modifiedAt: 1,
          }));
        },
        async readText(p) {
          return files.get(p)!;
        },
        async readBytes(p) {
          return new TextEncoder().encode(files.get(p)!);
        },
      };
      const out = memoryTarget();
      let inFlight = 0;
      let peak = 0;
      const copyFrom = out.target.copyFrom;
      out.target.copyFrom = async (src, from, to) => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((r) => setTimeout(r, 2));
        try {
          if (from === "a/f07.bin") {
            throw new Error("disk full");
          }
          await copyFrom(src, from, to);
        } finally {
          inFlight--;
        }
      };
      const base = run({ source, target: out.target, ...over });
      return { ...base, out, peak: () => peak };
    };

    test("copies run a few at a time, never more than the bound, and `written` keeps plan order", async () => {
      const { go, out, peak } = bigRun();
      const r = await go();
      expect(peak()).toBeGreaterThan(1);
      expect(peak()).toBeLessThanOrEqual(COPY_CONCURRENCY);
      expect(r.attachments).toBe(39);
      expect(r.errors).toEqual([{ path: "a/f07.bin", message: "disk full" }]);
      const names = r.written.filter((w) => w.startsWith("a/"));
      expect(names).toEqual([...names].sort());
      expect(r.written.slice(0, 6)).toEqual(
        Array.from({ length: 6 }, (_, i) => `n${i}.excalidraw`),
      );
      expect(out.files.size).toBe(6 + 39);
      expect(r.first).toBe("n0.excalidraw");
    });

    test("cancel in the middle of the copies stops within one batch", async () => {
      const ac = new AbortController();
      const { go, out } = bigRun({ signal: ac.signal });
      const copy = out.target.copyFrom;
      let n = 0;
      out.target.copyFrom = async (...a) => {
        if (++n === 10) {
          ac.abort("cancel");
        }
        await copy(...a);
      };
      const r = await go();
      expect(r.cancelled).toBe(true);
      expect(r.attachments).toBeLessThan(10 + COPY_CONCURRENCY);
      expect(r.attachments).toBeGreaterThanOrEqual(9);
    });
  });
});
