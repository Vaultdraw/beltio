/**
 * `ctx.pages.createDocument` / `buildScene` and `ctx.scene.scrollTo` (API
 * 0.9.0) through the real host with the fake backend, fake scene and the
 * test kit's bridge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildPageItems } from "../../sceneOps/pageText";
import { getWorkspaceBridge } from "../workspaceBridge";
import { boot, type TestPlugin } from "../testing";

import type { PageItem, PluginContext } from "../api";

let t: TestPlugin | undefined;
let ctx: PluginContext;
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await t?.dispose();
  t = undefined;
  vi.restoreAllMocks();
});

const bootPages = async () => {
  t = await boot(
    { id: "pg", activation: ["onStartupFinished"] },
    {
      activate(c) {
        ctx = c;
      },
    },
  );
  return t;
};

const text = (
  page: number,
  y: number,
  body = "hello",
  extra: Partial<Extract<PageItem, { type: "text" }>> = {},
): PageItem => ({
  type: "text",
  page,
  x: 40,
  y,
  width: 500,
  height: 25,
  text: body,
  fontSize: 20,
  fontFamily: "Helvetica",
  lineHeight: 1.25,
  ...extra,
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

describe("pages.createDocument", () => {
  it("creates a page-mode stub, de-duplicates the name and opens it", async () => {
    const p = await bootPages();
    p.vault.seed({ "Note (imported).excalidraw": [] });
    const doc = await ctx.pages.createDocument({ name: "Note (imported)" });
    expect(doc.path).toBe("Note (imported) 2.excalidraw");
    expect(ctx.workspace.activePath()).toBe(doc.path);
    expect(p.vault.pageSetup(doc.path)).toMatchObject({
      enabled: true,
      pageCount: 1,
      size: "a4",
    });
    expect(ctx.scene.elements()).toEqual([]);
    await doc.finish();
  });

  it("a document starts with the host's import look: paper theme and background", async () => {
    const p = await bootPages();
    const bridge = getWorkspaceBridge()!;
    bridge.importLook = () => ({
      paperTheme: "oldSchool",
      viewBackgroundColor: "#f8efd4",
      viewBackgroundPattern: null,
    });
    const doc = await ctx.pages.createDocument({ name: "Look" });
    expect(p.vault.pageSetup(doc.path)).toMatchObject({
      enabled: true,
      paperTheme: "oldSchool",
    });
    expect(p.scene.appState()).toMatchObject({
      viewBackgroundColor: "#f8efd4",
    });
    await doc.finish();
  });

  it("applies everything queued with ONE updateScene per frame, in order, without undo entries", async () => {
    const p = await bootPages();
    const doc = await ctx.pages.createDocument({ name: "N" });
    const before = p.scene.batches.length;
    doc.append([text(0, 0, "a"), text(0, 30, "b")], 1);
    doc.append([text(0, 60, "c")], 1);
    expect(p.scene.live()).toHaveLength(0); // nothing until the frame
    await p.flush();
    expect(p.scene.batches.length - before).toBe(1);
    expect(p.scene.batches.at(-1)?.captureUpdate).toBe("NEVER");
    const live = p.scene.live() as unknown as Record<string, unknown>[];
    expect(live.map((e) => e.text)).toEqual(["a", "b", "c"]);
    expect(live[0]).toMatchObject({
      type: "text",
      x: 40,
      y: 0,
      width: 500,
      height: 25,
      originalText: "a",
      autoResize: false,
      lineHeight: 1.25,
      fontFamily: 2,
      fontSize: 20,
      textAlign: "left",
      roughness: 0,
    });
    await doc.finish();
  });

  it("grows pageCount, never shrinks it, and places page n at n * pitch", async () => {
    const p = await bootPages();
    const doc = await ctx.pages.createDocument({ name: "N" });
    const pitch = ctx.pages.geometry().pitch;
    doc.append([text(2, 10, "p3")], 3);
    await p.flush();
    expect(p.scene.appState().pageSetup).toMatchObject({ pageCount: 3 });
    expect((p.scene.live()[0] as { y: number }).y).toBe(2 * pitch + 10);
    doc.append([text(0, 10, "p1")], 2);
    await p.flush();
    expect(p.scene.appState().pageSetup).toMatchObject({ pageCount: 3 });
    await doc.finish();
  });

  it("finish flushes the queue and saves once", async () => {
    const p = await bootPages();
    const doc = await ctx.pages.createDocument({ name: "N" });
    doc.append([text(0, 0, "a")], 1);
    await p.flush();
    doc.append([text(0, 30, "b")], 1);
    const result = await doc.finish(); // no flush: finish drains the frame itself
    expect(result.path).toBe("N.excalidraw");
    expect(result.revision).toMatch(/^rev-/);
    expect(p.vault.saves()).toEqual(["N.excalidraw"]);
    expect(p.vault.drawings()["N.excalidraw"]).toHaveLength(2);
    expect(p.vault.pageSetup("N.excalidraw")).toMatchObject({ pageCount: 1 });
    expect(() => doc.append([text(0, 0)], 1)).toThrow(/finished/);
  });

  it("abort drops what is queued, keeps and saves what was applied", async () => {
    const p = await bootPages();
    const doc = await ctx.pages.createDocument({ name: "N" });
    doc.append([text(0, 0, "kept")], 1);
    await p.flush();
    doc.append([text(0, 30, "dropped")], 1);
    await doc.abort();
    expect(p.scene.live().map((e) => (e as { text?: string }).text)).toEqual([
      "kept",
    ]);
    expect(p.vault.saves()).toEqual(["N.excalidraw"]);
    expect(p.vault.drawings()["N.excalidraw"]).toHaveLength(1);
  });

  it("a drawing closed mid-stream keeps what was applied; later items are dropped", async () => {
    const p = await bootPages();
    const doc = await ctx.pages.createDocument({ name: "N" });
    doc.append([text(0, 0, "a")], 1);
    await p.flush();
    p.scene.switchTo("other.excalidraw");
    doc.append([text(0, 30, "b")], 1);
    await p.flush();
    const result = await doc.finish();
    expect(result.path).toBe("N.excalidraw");
    expect(p.vault.saves()).toEqual([]); // the switch saved it; finish saves nothing more
    expect(p.scene.live()).toHaveLength(1); // untouched: it is another drawing now
  });

  it("open: false collects the items and writes the file once on finish, nothing opens", async () => {
    const p = await bootPages();
    const active = ctx.workspace.activePath();
    const doc = await ctx.pages.createDocument({
      name: "Quiet",
      open: false,
      setup: { size: "a5", layout: "continuous" },
    });
    doc.append([text(0, 0, "a"), text(3, 0, "d")], 4);
    expect(p.workspace.opened()).toEqual([]);
    expect(ctx.workspace.activePath()).toBe(active);
    const result = await doc.finish();
    expect(result.revision).toMatch(/^rev-/);
    expect(p.vault.drawings()["Quiet.excalidraw"]).toHaveLength(2);
    expect(p.vault.pageSetup("Quiet.excalidraw")).toMatchObject({
      pageCount: 4,
      size: "a5",
      layout: "continuous",
    });
  });

  it("items with one group name are one group across appends; a strong line is twice as wide", async () => {
    const p = await bootPages();
    const doc = await ctx.pages.createDocument({ name: "N" });
    const line = (y: number, extra: Partial<PageItem> = {}): PageItem =>
      ({
        type: "line",
        page: 0,
        x: 40,
        y,
        width: 200,
        height: 0,
        ...extra,
      } as PageItem);
    doc.append(
      [
        text(0, 0, "cell a", { group: "table-0" }),
        line(30, { group: "table-0", strong: true }),
        text(0, 60, "outside"),
      ],
      1,
    );
    await p.flush();
    doc.append(
      [
        text(0, 90, "cell b", { group: "table-0" }),
        line(120, { group: "table-1" }),
      ],
      1,
    );
    await p.flush();
    const live = p.scene.live() as unknown as {
      text?: string;
      type: string;
      groupIds: string[];
      strokeWidth: number;
    }[];
    const [a, rule, outside, b, other] = live;
    expect(a.groupIds).toHaveLength(1);
    expect(b.groupIds).toEqual(a.groupIds);
    expect(rule.groupIds).toEqual(a.groupIds);
    expect(outside.groupIds).toEqual([]);
    expect(other.groupIds).toHaveLength(1);
    expect(other.groupIds).not.toEqual(a.groupIds);
    expect([rule.strokeWidth, other.strokeWidth]).toEqual([2, 1]);
    expect(() =>
      doc.append([text(0, 0, "x", { group: "has space" })], 1),
    ).toThrow(/group/);
    expect(() => doc.append([line(0, { strong: "yes" as never })], 1)).toThrow(
      /strong/,
    );
    await doc.finish();
  });

  it("refuses invalid items and page counts with INVALID_ARGUMENT, queuing nothing", async () => {
    const p = await bootPages();
    const doc = await ctx.pages.createDocument({ name: "N" });
    expect(() =>
      doc.append([text(0, 0), { type: "blob" } as never], 1),
    ).toThrow(/items\[1\]\.type/);
    expect(() => doc.append([text(0, 0)], 0)).toThrow(/pageCount/);
    expect(() =>
      doc.append(
        [text(0, 0, "x", { link: ["javascript", "alert(1)"].join(":") })],
        1,
      ),
    ).toThrow(/link/);
    await p.flush();
    expect(p.scene.live()).toHaveLength(0);
    await doc.finish();
    await expect(
      ctx.pages.createDocument({ name: "bad/name" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    p.vault.setVault({ name: "ro", readOnly: true });
    await expect(ctx.pages.createDocument({ name: "N" })).rejects.toMatchObject(
      { code: "READ_ONLY" },
    );
    p.vault.setVault(null);
    await expect(ctx.pages.createDocument({ name: "N" })).rejects.toMatchObject(
      { code: "NO_VAULT" },
    );
  });

  it("images: bytes become a file and an image element, no bytes a linked placeholder", async () => {
    const p = await bootPages();
    const doc = await ctx.pages.createDocument({ name: "N" });
    doc.append(
      [
        {
          type: "image",
          page: 0,
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          mimeType: "image/png",
          bytes: PNG,
          target: "pic.png",
        },
        {
          type: "image",
          page: 0,
          x: 0,
          y: 100,
          width: 100,
          height: 80,
          mimeType: "image/bmp",
          alt: "a diagram",
          target: "missing.bmp",
        },
      ],
      1,
    );
    await p.flush();
    await p.flush(); // hashing is async: a second frame
    const live = p.scene.live() as unknown as Record<string, unknown>[];
    expect(live.map((e) => e.type)).toEqual(["image", "rectangle", "text"]);
    const fileId = live[0].fileId as string;
    expect(fileId).toMatch(/^[0-9a-f]{40}$/);
    expect(p.scene.files()[fileId]).toMatchObject({ mime: "image/png" });
    expect(live[1]).toMatchObject({ link: "missing.bmp" });
    expect(live[2]).toMatchObject({ text: "a diagram", link: null }); // only the box is linked
    await doc.finish();
  });

  it("a picture placeholder reads in the family of the note's text", async () => {
    const p = await bootPages();
    const doc = await ctx.pages.createDocument({ name: "F" });
    doc.append(
      [
        text(0, 0, "body", { fontFamily: "Nunito" }),
        {
          type: "image",
          page: 0,
          x: 0,
          y: 100,
          width: 100,
          height: 80,
          mimeType: "image/bmp",
          alt: "chip",
          target: "chip.bmp",
        },
      ],
      1,
    );
    await p.flush();
    const live = p.scene.live() as unknown as Record<string, unknown>[];
    const label = live.find((e) => e.text === "chip")!;
    expect(label.fontFamily).toBe(6); // Nunito
    await doc.finish();
  });

  it("keeps the order when a chunk with pictures is followed by one without", async () => {
    const p = await bootPages();
    const doc = await ctx.pages.createDocument({ name: "N" });
    doc.append(
      [
        {
          type: "image",
          page: 0,
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          mimeType: "image/png",
          bytes: PNG,
          target: "p.png",
        },
      ],
      1,
    );
    doc.append([text(0, 50, "after")], 1);
    await doc.finish();
    expect(p.scene.live().map((e) => e.type)).toEqual(["image", "text"]);
  });

  it("disposing the plugin aborts an open document and saves what was applied", async () => {
    const p = await bootPages();
    const doc = await ctx.pages.createDocument({ name: "N" });
    doc.append([text(0, 0, "a")], 1);
    await p.flush();
    await p.disable();
    await p.flush();
    expect(p.vault.saves()).toEqual(["N.excalidraw"]);
    expect(() => doc.append([text(0, 0)], 1)).toThrow(/finished/);
  });
});

describe("pages.buildScene", () => {
  it("returns .excalidraw JSON with elements, pageSetup and files", async () => {
    await bootPages();
    const scene = (await ctx.pages.buildScene(
      [
        text(0, 0, "a", { tone: "link", link: "https://x.y", data: { h: 2 } }),
        {
          type: "rect",
          page: 1,
          x: 0,
          y: 0,
          width: 50,
          height: 20,
          fill: "code",
        },
        { type: "line", page: 1, x: 0, y: 30, width: 50, height: 0 },
        {
          type: "image",
          page: 1,
          x: 0,
          y: 40,
          width: 10,
          height: 10,
          mimeType: "image/png",
          bytes: PNG,
          target: "p.png",
        },
      ],
      { pageCount: 2, setup: { size: "letter", orientation: "landscape" } },
    )) as {
      type: string;
      elements: Record<string, unknown>[];
      appState: { pageSetup: Record<string, unknown> };
      files: Record<string, { mimeType: string; dataURL: string }>;
    };
    expect(scene.type).toBe("excalidraw");
    expect(scene.appState.pageSetup).toMatchObject({
      enabled: true,
      pageCount: 2,
      size: "letter",
      orientation: "landscape",
    });
    expect(scene.elements.map((e) => e.type)).toEqual([
      "text",
      "rectangle",
      "line",
      "image",
    ]);
    expect(scene.elements[0]).toMatchObject({
      strokeColor: "#1971c2",
      link: "https://x.y",
      customData: { "plugins.pg": { h: 2 } },
    });
    expect(scene.elements[1]).toMatchObject({
      backgroundColor: "#e9ecef",
      strokeColor: "transparent",
      y: ctx.pages.geometry({ size: "letter", orientation: "landscape" }).pitch,
    });
    const [file] = Object.values(scene.files);
    expect(file.mimeType).toBe("image/png");
    expect(file.dataURL.startsWith("data:image/png;base64,")).toBe(true);
    await expect(
      ctx.pages.buildScene([text(0, 0)], { pageCount: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
});

describe("scene.scrollTo", () => {
  it("asks the shell to focus the element of the open drawing", async () => {
    const p = await bootPages();
    p.scene.setElements([{ id: "e1", type: "rectangle" }]);
    ctx.scene.scrollTo("e1");
    ctx.scene.scrollTo(7 as never);
    expect(p.scene.scrolledTo()).toEqual(["e1"]);
    p.scene.switchTo(null);
    ctx.scene.scrollTo("e1");
    expect(p.scene.scrolledTo()).toEqual(["e1"]);
  });
});

describe("timing (jsdom, indicative; one run)", () => {
  const lines = (n: number): PageItem[] =>
    Array.from({ length: n }, (_, i) =>
      text(Math.floor(i / 40), (i % 40) * 25, `line ${i} of the note body`),
    );

  it("build + insert of 1,000 and 4,000 text items, and per-frame chunks of 100 / 200", async () => {
    await bootPages();
    const out: string[] = [];
    for (const n of [1000, 4000]) {
      const doc = await ctx.pages.createDocument({ name: `t${n}` });
      const t0 = performance.now();
      doc.append(lines(n), Math.ceil(n / 40));
      await doc.finish();
      out.push(
        `build+insert ${n} items: ${(performance.now() - t0).toFixed(1)} ms`,
      );
    }
    for (const chunk of [100, 200]) {
      const items = lines(chunk);
      const t0 = performance.now();
      buildPageItems(items, {});
      out.push(
        `build ${chunk} items (one frame's work before updateScene): ${(
          performance.now() - t0
        ).toFixed(2)} ms`,
      );
    }
    process.stdout.write(`PAGES TIMING ${out.join(" | ")}\n`);
    expect(out).toHaveLength(4);
  });
});
