import { describe, expect, it } from "vitest";

import { layoutTable, opCount, PAD, wrap, type Measure } from "../src/layout";

// Every character is 10 px wide, a line is 20 px high.
const m: Measure = {
  widths: (s) => s.map((x) => x.length * 10),
  lineHeight: 1.25,
};
const style = {
  fontFamily: "Excalifont" as const,
  fontSize: 16,
  strokeColor: "#112233",
  maxColWidth: 200,
};

describe("wrap", () => {
  it("wraps at words and keeps paragraphs", () => {
    expect(wrap("aa bb cc dd", 50, m)).toEqual(["aa bb", "cc dd"]);
    expect(wrap("a\nb", 100, m)).toEqual(["a", "b"]);
    expect(wrap("   ", 100, m)).toEqual([]);
  });
  it("cuts a word wider than the line", () => {
    expect(wrap("abcdefgh", 30, m)).toEqual(["abc", "def", "gh"]);
  });
});

describe("layoutTable", () => {
  const table = {
    delimiter: "tab" as const,
    header: true,
    rows: [
      ["Name", "Note"],
      ["Apple", ""],
    ],
  };
  const all = layoutTable(table, style, m, 100, 50);
  const adds = all.ops.flatMap((o) => (o.op === "add" ? [o] : []));

  it("sizes columns to content plus padding", () => {
    expect(all.width).toBe(5 * 10 + 2 * PAD + 4 * 10 + 2 * PAD);
    expect(all.height).toBe(2 * (20 + 2 * PAD));
  });
  it("groups every element once", () => {
    const group = all.ops.at(-1);
    expect(group?.op).toBe("group");
    expect(group && "ids" in group ? group.ids : []).toHaveLength(adds.length);
    expect(opCount(table)).toBe(all.ops.length);
  });
  it("makes a shaded header, an outline, grid lines and texts in the stroke colour", () => {
    expect(
      adds.find((a) => a.ref === "header")?.element.backgroundColor,
    ).toBeTruthy();
    expect(adds.filter((a) => a.element.type === "line")).toHaveLength(2);
    const texts = adds.filter((a) => a.element.type === "text");
    expect(texts.map((t) => t.element.text)).toEqual(["Name", "Note", "Apple"]);
    expect(texts.every((t) => t.element.strokeColor === "#112233")).toBe(true);
    expect(adds.find((a) => a.ref === "h1")?.element.strokeWidth).toBe(2);
    expect(texts[0].element).toMatchObject({ x: 100 + PAD, y: 50 + PAD });
  });
  it("wraps long cells at the maximum width", () => {
    const t = layoutTable(
      {
        ...table,
        rows: [
          ["h1", "h2"],
          ["a b c d e f g h i j k l m n o p q r s t", "x"],
        ],
      },
      style,
      m,
      0,
      0,
    );
    expect(t.width).toBeLessThanOrEqual(2 * 200);
    const text = t.ops.flatMap((o) =>
      o.op === "add" && o.element.type === "text" ? [o.element.text] : [],
    );
    expect(text.some((s) => s?.includes("\n"))).toBe(true);
  });
  it("has no header shade for a header-less table", () => {
    const t = layoutTable({ ...table, header: false }, style, m, 0, 0);
    expect(t.ops.some((o) => o.op === "add" && o.ref === "header")).toBe(false);
  });
});
