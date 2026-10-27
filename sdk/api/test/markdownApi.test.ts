/** API 0.8.0 rules: the paginator, page geometry, text and markdown checks, and the mock's members. */
import { describe, expect, it } from "vitest";

import { API_REVISION } from "../shared/features";
import { boot } from "../testing";
import { fakeParseMarkdown, markdownParams } from "../shared/markdown";
import { flowPages, pageGeometry } from "../shared/pages";
import { checkFamilies, checkStrings } from "../shared/text";

import type { FlowItem, PluginContext } from "../src/index";

const flow = (items: FlowItem[], contentHeight = 100) =>
  flowPages(items, { contentHeight }).map((p) => [p.page, p.y]);

describe("pages.flow", () => {
  it("fills a page, then moves on", () => {
    expect(flow([{ height: 40 }, { height: 40 }, { height: 40 }])).toEqual([
      [0, 0],
      [0, 40],
      [1, 0],
    ]);
  });

  it("drops spaceBefore at the top of a page", () => {
    expect(
      flow([
        { height: 50 },
        { height: 40, spaceBefore: 20 },
        { height: 10, spaceBefore: 5 },
      ]),
    ).toEqual([
      [0, 0],
      [1, 0],
      [1, 45],
    ]);
  });

  it("keeps a heading with the next item", () => {
    expect(
      flow([
        { height: 70 },
        { height: 20, keepWithNext: true },
        { height: 20 },
      ]),
    ).toEqual([
      [0, 0],
      [1, 0],
      [1, 20],
    ]);
  });

  it("breaks inside a chain taller than a page", () => {
    const chain = Array.from({ length: 6 }, () => ({
      height: 30,
      keepWithNext: true,
    }));
    const out = flow([{ height: 10 }, ...chain, { height: 30 }]);
    expect(out[1]).toEqual([0, 10]);
    expect(out[out.length - 1][0]).toBeGreaterThan(0);
    // Never more than a page on one page.
    for (const [page] of out) {
      const used = out.filter((o) => o[0] === page).length;
      expect(used).toBeLessThanOrEqual(4);
    }
  });

  it("honours breakBefore except on an empty page", () => {
    expect(
      flow([
        { height: 10, breakBefore: true },
        { height: 10, breakBefore: true },
      ]),
    ).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it("gives an oversized item its own page", () => {
    expect(flow([{ height: 10 }, { height: 300 }, { height: 10 }])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });

  it("is linear: 200,000 lines in well under a second", () => {
    const items = Array.from({ length: 200_000 }, (_, i) => ({
      height: 18,
      keepWithNext: i % 40 === 0,
    }));
    const t0 = performance.now();
    const out = flowPages(items, { contentHeight: 1000 });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(out).toHaveLength(200_000);
  });

  it("checks its arguments", () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as { code?: string }).code;
      }
      return null;
    };
    expect(code(() => flowPages({} as never, { contentHeight: 1 }))).toBe(
      "INVALID_ARGUMENT",
    );
    expect(code(() => flowPages([], { contentHeight: 0 }))).toBe(
      "INVALID_ARGUMENT",
    );
    expect(code(() => flowPages([{ height: -1 }], { contentHeight: 10 }))).toBe(
      "INVALID_ARGUMENT",
    );
  });
});

describe("pages.geometry", () => {
  it("knows the sizes, orientation and layout", () => {
    expect(pageGeometry({ size: "letter" })).toEqual({
      width: 816,
      height: 1056,
      gap: 40,
      pitch: 1096,
    });
    expect(
      pageGeometry({
        size: "a4",
        orientation: "landscape",
        layout: "continuous",
      }),
    ).toEqual({ width: 1123, height: 794, gap: 0, pitch: 794 });
    expect(pageGeometry({ size: { width: 500.4, height: 700 } })).toMatchObject(
      {
        width: 500,
        height: 700,
      },
    );
    expect(() => pageGeometry({ size: "b4" as never })).toThrow(/Unknown/);
    expect(() => pageGeometry({ size: { width: 50, height: 700 } })).toThrow();
  });
});

describe("markdown and text checks", () => {
  it("passes options through and refuses bad ones", () => {
    expect(markdownParams("x")).toEqual({ text: "x" });
    expect(markdownParams("x", { softBreakNewline: false })).toEqual({
      text: "x",
      softBreakNewline: false,
    });
    expect(() => markdownParams(null)).toThrow();
  });

  it("refuses text over 16 MiB of UTF-8", () => {
    expect(() => markdownParams("é".repeat(8 * 1024 * 1024 + 1))).toThrow(
      /16 MiB/,
    );
  });

  it("fake parser keeps byte ranges into the source", () => {
    const text = "# é\n\npara #t [[N#H]]";
    const doc = fakeParseMarkdown(text);
    const bytes = new TextEncoder().encode(text);
    const [s, e] = doc.blocks[1].range;
    expect(new TextDecoder().decode(bytes.slice(s, e))).toBe("para #t [[N#H]]");
    expect(doc.links[0]).toMatchObject({ target: "N", heading: "H" });
  });

  it("dedupes families and defaults the sample text", () => {
    const r = checkFamilies(["Virgil", "Virgil"], undefined);
    expect(r.families).toEqual(["Virgil"]);
    expect(r.text).toContain("A");
    expect(() => checkStrings(new Array(100_001).fill(""))).toThrow();
  });
});

describe("the mock host", () => {
  it("offers the 0.8.0 members", async () => {
    let ctx!: PluginContext;
    const t = await boot(
      { id: "mk", activation: ["onStartupFinished"] },
      {
        activate(c) {
          ctx = c;
        },
      },
    );
    try {
      expect(ctx.host.api.revision).toBe(API_REVISION);
      for (const f of [
        "markdown.parse",
        "text.measure",
        "fonts.ensure",
        "pages.flow",
      ]) {
        expect(ctx.host.has(f)).toBe(true);
      }
      const doc = await ctx.markdown.parse("# A\n\nb #tag");
      expect(doc.tags).toEqual(["tag"]);
      expect([
        ...ctx.text.measure({ family: "Virgil", size: 10 }, ["abc"]),
      ]).toEqual([15]);
      await expect(ctx.fonts.ensure(["Virgil"])).resolves.toBeUndefined();
      expect(ctx.pages.geometry().width).toBe(794);
    } finally {
      await t.dispose();
    }
  });
});
