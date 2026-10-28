import { afterEach, describe, expect, it } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { PdfImportAborted } from "../src/errors";
import { importPdf } from "../src/importPdf";

import type { PdfImportSettings, PluginContext } from "@vaultdraw/api";

const S: PdfImportSettings = {
  maxSide: 1440,
  format: "jpeg",
  quality: 0.85,
  lockPages: true,
  warnPages: 50,
  pixelBudgetMp: 60,
};

const A4 = { widthPt: 595, heightPt: 842 };
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);
const path = "fake.excalidraw";

let p: TestPlugin | undefined;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

/** A plugin with the pdf permission, a drawing, and an `n`-page document ready to import. */
const setup = async (n: number) => {
  let ctx!: PluginContext;
  p = await boot(
    {
      id: "pdf-import",
      permissions: ["pdf"],
      activation: ["onStartupFinished"],
    },
    {
      activate(c) {
        ctx = c;
      },
    },
  );
  p.pdf.nextPick = { name: "doc.pdf", pages: Array(n).fill(A4) };
  const doc = (await ctx.pdf.pick())!;
  return { ctx, doc, indices: Array.from({ length: n }, (_, i) => i) };
};

/** A distinct picture per page (equal pictures are stored once). */
const picture = (size: number) => (index: number) => {
  const bytes = new Uint8Array(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = index;
  return bytes;
};

describe("importPdf", () => {
  it("commits once: locked pictures with provenance, then closes the document", async () => {
    const { ctx, doc, indices } = await setup(3);
    p!.pdf.renderBytes = picture(1000);
    const progress: number[] = [];
    const result = await importPdf({
      ctx,
      doc,
      indices,
      settings: S,
      path,
      onProgress: (x) => progress.push(x.done),
    });
    expect(result).toEqual({ imported: 3, skipped: [], truncated: 0 });
    expect(progress).toEqual([0, 1, 2, 3]);
    expect(p!.scene.batches).toHaveLength(1);
    const els = p!.scene.live();
    expect(els).toHaveLength(3);
    for (const [k, el] of els.entries()) {
      expect(el).toMatchObject({ type: "image", locked: true });
      expect(ctx.scene.dataOf(el.id as string)).toEqual({
        name: "doc.pdf",
        page: k + 1,
      });
    }
    expect(p!.pdf.closed).toHaveLength(1);
  });

  it("does not lock when lockPages is off", async () => {
    const { ctx, doc } = await setup(1);
    await importPdf({
      ctx,
      doc,
      indices: [0],
      settings: { ...S, lockPages: false },
      path,
    });
    expect(p!.scene.live()[0]).toMatchObject({ locked: false });
  });

  it("takes a PNG answer to a JPEG request", async () => {
    const { ctx, doc } = await setup(1);
    p!.pdf.renderBytes = () => PNG;
    await importPdf({ ctx, doc, indices: [0], settings: S, path });
    expect(p!.scene.live()).toHaveLength(1);
    expect(p!.pdf.renders[0].options.format).toBe("jpeg");
  });

  it("abort commits nothing and still closes the document", async () => {
    const { ctx, doc, indices } = await setup(5);
    const ac = new AbortController();
    await expect(
      importPdf({
        ctx,
        doc,
        indices,
        settings: S,
        path,
        signal: ac.signal,
        onProgress: ({ done }) => done === 2 && ac.abort(),
      }),
    ).rejects.toBeInstanceOf(PdfImportAborted);
    expect(p!.scene.batches).toHaveLength(0);
    expect(new Set(p!.pdf.renders.map((r) => r.index))).toEqual(
      new Set([0, 1]),
    );
    expect(p!.pdf.closed).toHaveLength(1);
  });

  it("skips pages that fail and places the rest without holes", async () => {
    const { ctx, doc, indices } = await setup(3);
    p!.pdf.renderBytes = picture(1000);
    p!.pdf.failPages = new Set([1]);
    const result = await importPdf({ ctx, doc, indices, settings: S, path });
    expect(result).toMatchObject({ imported: 2, skipped: [1] });
    const els = p!.scene.live();
    expect(els.map((e) => ctx.scene.dataOf(e.id as string))).toEqual([
      { name: "doc.pdf", page: 1 },
      { name: "doc.pdf", page: 3 },
    ]);
  });

  it("rethrows other errors, commits nothing and still closes", async () => {
    const { ctx, doc, indices } = await setup(2);
    p!.pdf.renderBytes = () => {
      throw Object.assign(new Error("x"), { code: "PDF_BAD_TOKEN" });
    };
    await expect(
      importPdf({ ctx, doc, indices, settings: S, path }),
    ).rejects.toThrow("x");
    expect(p!.scene.batches).toHaveLength(0);
    expect(p!.pdf.closed).toHaveLength(1);
  });

  it("stops at the byte budget and commits what fits", async () => {
    const { ctx, doc, indices } = await setup(40);
    // incompressible: 2 MB per page whatever the size asked for
    p!.pdf.renderBytes = picture(2_000_000);
    const result = await importPdf({ ctx, doc, indices, settings: S, path });
    expect(result.imported).toBeGreaterThan(0);
    expect(result.imported).toBeLessThan(40);
    expect(result.imported + result.truncated).toBe(40);
    expect(p!.scene.batches).toHaveLength(1);
    expect(p!.scene.live()).toHaveLength(result.imported);
  });

  it("re-renders an oversized page once at a smaller size", async () => {
    const { ctx, doc, indices } = await setup(12);
    p!.pdf.renderBytes = (_i, o) =>
      picture(Math.floor(o.maxSide * o.maxSide * 3))(0);
    await importPdf({ ctx, doc, indices, settings: S, path });
    const [first, second] = p!.pdf.renders;
    expect(second.index).toBe(0);
    expect(second.options.maxSide).toBeLessThan(first.options.maxSide);
    expect(second.options.quality).toBeCloseTo(first.options.quality - 0.1);
  });

  it("skips a page whose picture exceeds the 10 MiB limit", async () => {
    const { ctx, doc } = await setup(1);
    p!.pdf.renderBytes = picture(11 * 1024 * 1024);
    const result = await importPdf({
      ctx,
      doc,
      indices: [0],
      settings: S,
      path,
    });
    expect(result).toMatchObject({ imported: 0, skipped: [0] });
    expect(p!.scene.batches).toHaveLength(0);
  });

  it("commits nothing when every page fails", async () => {
    const { ctx, doc } = await setup(1);
    p!.pdf.failPages = new Set([0]);
    const result = await importPdf({
      ctx,
      doc,
      indices: [0],
      settings: S,
      path,
    });
    expect(result.imported).toBe(0);
    expect(p!.scene.batches).toHaveLength(0);
    expect(p!.pdf.closed).toHaveLength(1);
  });

  it("the batch is refused when another drawing became active", async () => {
    const { ctx, doc, indices } = await setup(1);
    await expect(
      importPdf({ ctx, doc, indices, settings: S, path: "other.excalidraw" }),
    ).rejects.toMatchObject({ code: "DRAWING_CHANGED" });
    expect(p!.pdf.closed).toHaveLength(1);
  });
});
