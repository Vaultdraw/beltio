import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FONT_FAMILY } from "@excalidraw/common";
import { Fonts } from "@excalidraw/excalidraw/fonts/Fonts";

import { boot, type TestPlugin } from "../testing";

import { getPluginsBackend } from "./backend";

import type { createFakeBackend } from "./fakeBackend";
import type { PluginContext } from "../api";

let t: TestPlugin | undefined;
let ctx: PluginContext;
beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  t = await boot(
    { id: "md", activation: ["onStartupFinished"] },
    {
      activate(c) {
        ctx = c;
      },
    },
  );
});
afterEach(async () => {
  await t?.dispose();
  t = undefined;
  vi.restoreAllMocks();
});

const calls = () =>
  (getPluginsBackend() as ReturnType<typeof createFakeBackend>).gatewayCalls;

describe("ctx.markdown", () => {
  it("parses through one markdown.parse gateway call, no permission needed", async () => {
    const doc = await ctx.markdown.parse("# Title\n\nSee [[Other|o]] #idea", {
      softBreakNewline: true,
    });
    expect(doc.schemaVersion).toBe(1);
    expect(doc.blocks.map((b) => b.kind)).toEqual(["heading", "paragraph"]);
    expect(doc.tags).toEqual(["idea"]);
    expect(doc.links[0]).toMatchObject({ target: "Other", alias: "o" });
    const md = calls().filter((c) => c.method === "markdown.parse");
    expect(md).toEqual([
      {
        pluginId: "md",
        method: "markdown.parse",
        params: {
          text: "# Title\n\nSee [[Other|o]] #idea",
          softBreakNewline: true,
        },
      },
    ]);
  });

  it("refuses bad arguments before the native call", async () => {
    await expect(ctx.markdown.parse(3 as never)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(
      ctx.markdown.parse("x", { softBreakNewline: "yes" as never }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(calls().some((c) => c.method === "markdown.parse")).toBe(false);
  });

  it("is the same object on every read (built once)", () => {
    expect(ctx.markdown).toBe(ctx.markdown);
    expect(ctx.text).toBe(ctx.text);
    expect(ctx.fonts).toBe(ctx.fonts);
    expect(ctx.pages).toBe(ctx.pages);
  });
});

describe("ctx.text", () => {
  it("measures every string in order with the editor's measure", () => {
    const w = ctx.text.measure({ family: "Liberation Sans", size: 20 }, [
      "",
      "ab",
      "ab",
      "abcd",
    ]);
    expect(w).toBeInstanceOf(Float64Array);
    expect(w).toHaveLength(4);
    expect(w[0]).toBe(0);
    expect(w[1]).toBe(w[2]);
    expect(w[3]).toBeGreaterThan(0);
  });

  it("checks fonts and sizes", () => {
    expect(() =>
      ctx.text.measure({ family: "Comic Sans" as never, size: 20 }, ["a"]),
    ).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(() =>
      ctx.text.measure({ family: "Virgil", size: 0 }, ["a"]),
    ).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(() =>
      ctx.text.measure({ family: "Virgil", size: 10 }, [1 as never]),
    ).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });

  it("gives the editor's line height", () => {
    expect(ctx.text.lineHeight("Cascadia")).toBe(1.2);
    expect(ctx.text.lineHeight("Liberation Sans")).toBe(1.15);
  });
});

describe("ctx.fonts", () => {
  it("loads the families for the given text through the editor's font loader", async () => {
    const load = vi.spyOn(Fonts, "loadElementsFonts").mockResolvedValue([]);
    await ctx.fonts.ensure(["Excalifont", "Excalifont", "Cascadia"], "héllo");
    expect(load).toHaveBeenCalledTimes(1);
    const probes = load.mock.calls[0][0];
    expect(probes.map((p) => p.fontFamily)).toEqual([
      FONT_FAMILY.Excalifont,
      FONT_FAMILY.Cascadia,
    ]);
    expect(probes.every((p) => p.type === "text")).toBe(true);
  });

  it("does nothing for no families and refuses unknown ones", async () => {
    const load = vi.spyOn(Fonts, "loadElementsFonts");
    await ctx.fonts.ensure([]);
    expect(load).not.toHaveBeenCalled();
    await expect(ctx.fonts.ensure(["Arial" as never])).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  it("fails with FONT_UNAVAILABLE when loading never finishes", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(Fonts, "loadElementsFonts").mockReturnValue(
        new Promise(() => {}),
      );
      const p = ctx.fonts.ensure(["Virgil"]);
      const check = expect(p).rejects.toMatchObject({
        code: "FONT_UNAVAILABLE",
      });
      await vi.advanceTimersByTimeAsync(10_000);
      await check;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ctx.pages", () => {
  it("gives the editor's A4 page by default", () => {
    expect(ctx.pages.geometry()).toEqual({
      width: 794,
      height: 1123,
      gap: 40,
      pitch: 1163,
    });
  });

  it("flows items onto pages", () => {
    expect(
      ctx.pages.flow([{ height: 60 }, { height: 60 }], { contentHeight: 100 }),
    ).toEqual([
      { page: 0, y: 0 },
      { page: 1, y: 0 },
    ]);
  });
});
