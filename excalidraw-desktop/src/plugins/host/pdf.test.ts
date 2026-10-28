/**
 * `ctx.pdf` (API 0.23.0) through the real host over the fake backend's `pdf.*` rows: permission,
 * the body formats, documents, unlock, errors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakePdfBridge, makePages } from "../../tests/fakePdfBridge";
import { boot, type TestPlugin } from "../testing";

import { getPluginsBackend } from "./backend";

import type { PluginContext, PluginPermission } from "../api";
import type { createFakeBackend } from "./fakeBackend";

let t: TestPlugin | undefined;
let ctx: PluginContext;
let bridge: FakePdfBridge;
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await t?.dispose();
  t = undefined;
  vi.restoreAllMocks();
});

const bootPdf = async (permissions: PluginPermission[] = ["pdf"]) => {
  t = await boot(
    { id: "pd", permissions, activation: ["onStartupFinished"] },
    {
      activate(c) {
        ctx = c;
      },
    },
  );
  bridge = new FakePdfBridge({ pages: makePages(3) });
  (getPluginsBackend() as ReturnType<typeof createFakeBackend>).pdf = bridge;
};

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? "no code",
  );

const OPTIONS = { maxSide: 400, format: "jpeg" as const, quality: 0.8 };

describe("ctx.pdf", () => {
  it("every call needs the permission pdf", async () => {
    await bootPdf([]);
    expect(await code(ctx.pdf.pick())).toBe("PERMISSION");
    expect(await code(ctx.pdf.open("a.pdf", new Uint8Array([1])))).toBe(
      "PERMISSION",
    );
  });

  it("pick returns a document, or null when cancelled", async () => {
    await bootPdf();
    expect(await ctx.pdf.pick()).toBeNull();
    bridge.nextPick = bridge.makeDoc("a.pdf");
    const doc = (await ctx.pdf.pick())!;
    expect(doc).toMatchObject({ name: "a.pdf", pageCount: 3, locked: false });
    expect(doc.pages).toHaveLength(3);
    expect(Object.isFrozen(doc.pages)).toBe(true);
  });

  it("open sends the name and the bytes; render and close reach the renderer", async () => {
    await bootPdf();
    const doc = await ctx.pdf.open("my file.pdf", new Uint8Array([1, 2, 3]));
    expect(doc.name).toBe("my file.pdf");
    const bytes = await doc.render(1, OPTIONS);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bridge.renders[0]).toMatchObject({ index: 1, opts: OPTIONS });
    await doc.close();
    expect(bridge.closes).toHaveLength(1);
    expect(await code(doc.render(0, OPTIONS))).toBe("PDF_BAD_TOKEN");
  });

  it("a locked document unlocks with the right password only", async () => {
    await bootPdf();
    bridge.password = "pw";
    const doc = await ctx.pdf.open("l.pdf", new Uint8Array([1]));
    expect(doc).toMatchObject({ locked: true, pageCount: 0 });
    expect(await code(doc.unlock("no"))).toBe("PDF_BAD_PASSWORD");
    const open = await doc.unlock("pw");
    expect(open).toMatchObject({ locked: false, pageCount: 3 });
  });

  it("refuses bad arguments before the call", async () => {
    await bootPdf();
    expect(await code(ctx.pdf.open("", new Uint8Array([1])))).toBe(
      "INVALID_ARGUMENT",
    );
    expect(await code(ctx.pdf.open("a.pdf", new Uint8Array(0)))).toBe(
      "INVALID_ARGUMENT",
    );
    expect(bridge.opened).toHaveLength(0);
  });

  it("native errors keep their code", async () => {
    await bootPdf();
    bridge.failPages = new Set([2]);
    const doc = await ctx.pdf.open("a.pdf", new Uint8Array([1]));
    expect(await code(doc.render(2, OPTIONS))).toBe("PDF_PAGE_FAILED");
    bridge.openError = "PDF_INVALID";
    expect(await code(ctx.pdf.open("b.pdf", new Uint8Array([1])))).toBe(
      "PDF_INVALID",
    );
  });

  it("settings() reads the [pdf_import] values", async () => {
    await bootPdf();
    expect(ctx.pdf.settings()).toMatchObject({
      maxSide: 1440,
      format: "jpeg",
      lockPages: true,
    });
  });
});
