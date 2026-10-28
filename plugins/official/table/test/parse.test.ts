import { describe, expect, it } from "vitest";

import { parseTable, splitDelimited, splitPipeRow } from "../src/parse";

describe("splitDelimited", () => {
  it("handles quotes, doubled quotes and quoted line breaks", () => {
    expect(splitDelimited('a,"b, c","say ""hi"""\n1,2,3', ",")).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
    expect(splitDelimited('x\t"two\nlines"\ty\r\n1\t2\t3\r\n', "\t")).toEqual([
      ["x", "two\nlines", "y"],
      ["1", "2", "3"],
    ]);
  });
  it("keeps empty fields and a quote inside an unquoted field", () => {
    expect(splitDelimited('a,,5"x\n', ",")).toEqual([["a", "", '5"x']]);
  });
});

describe("parseTable", () => {
  it("reads tab-separated spreadsheet cells", () => {
    const t = parseTable("Name\tQty\nApple\t3\nPear\t10\n");
    expect(t).toEqual({
      delimiter: "tab",
      header: true,
      rows: [
        ["Name", "Qty"],
        ["Apple", "3"],
        ["Pear", "10"],
      ],
    });
  });
  it("reads a tab table with a quoted multi-line cell", () => {
    const t = parseTable('a\tb\n"x\ny"\tz');
    expect(t?.rows).toEqual([
      ["a", "b"],
      ["x\ny", "z"],
    ]);
  });
  it("reads CSV with quotes, and semicolon CSV", () => {
    expect(parseTable('a,b\n"1, 2",3')?.rows).toEqual([
      ["a", "b"],
      ["1, 2", "3"],
    ]);
    expect(parseTable("a;b\n1;2")?.delimiter).toBe("semicolon");
  });
  it("reads a Markdown pipe table with header, alignment and escaped pipes", () => {
    const t = parseTable("| A | B |\n|:--|--:|\n| x \\| y | 2 |\n");
    expect(t).toEqual({
      delimiter: "pipe",
      header: true,
      rows: [
        ["A", "B"],
        ["x | y", "2"],
      ],
    });
  });
  it("reads a pipe table without outer pipes when it has the --- line", () => {
    const t = parseTable("A | B\n--- | ---\n1 | 2");
    expect(t?.rows).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
  });
  it("accepts a framed pipe table without a header line, header false", () => {
    expect(parseTable("| a | b |\n| c | d |")?.header).toBe(false);
  });
  it("pads short rows", () => {
    expect(
      parseTable("a\tb\tc\n1\t2\t3\n4\t5\t6\n7\t8\t9\n10\t11\n")?.rows[4],
    ).toEqual(["10", "11", ""]);
  });
  it("is not fooled by prose, single lines or code", () => {
    expect(parseTable("Hello, world")).toBeNull();
    expect(parseTable("one line\twith a tab")).toBeNull();
    expect(
      parseTable("First, a thing.\nSecond, another, longer one.\nThird."),
    ).toBeNull();
    expect(parseTable("a || b\nif (x) { y }")).toBeNull();
    expect(parseTable("")).toBeNull();
    expect(parseTable("single column\nrow\nrow")).toBeNull();
  });
});

describe("splitPipeRow", () => {
  it("drops the outer pipes only", () => {
    expect(splitPipeRow("| a | | c |")).toEqual(["a", "", "c"]);
    expect(splitPipeRow("a | b")).toEqual(["a", "b"]);
  });
});

describe("parseTable on huge pastes", () => {
  it("does not throw on many short rows and refuses past the limit", () => {
    const rows = "1,2\n".repeat(120_000);
    const t = parseTable(rows);
    expect(t === null || t.rows.length > 200).toBe(true);
    const pipes = "|a|b|\n".repeat(30_000);
    expect(() => parseTable(pipes)).not.toThrow();
    expect(() => parseTable("1,2\n".repeat(500_000))).not.toThrow(); // over the text cap: null
    expect(parseTable("1,2\n".repeat(500_000))).toBeNull();
  });
});
