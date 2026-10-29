import { describe, expect, it } from "vitest";

import {
  lineEnd,
  lineStart,
  listItemOf,
  matchLineTrigger,
  nextMarker,
  toggledTask,
} from "./lineRules";

describe("matchLineTrigger: the text before the caret when a space is typed", () => {
  it.each([
    ["#", 1],
    ["##", 2],
    ["###", 3],
    ["####", 4],
    ["#####", 5],
    ["######", 6],
  ])("%s makes heading %i", (before, level) => {
    expect(matchLineTrigger(before)).toEqual({ kind: "heading", level });
  });

  it.each([
    ["", "nothing typed"],
    ["#######", "seven #: not a heading in Markdown"],
    [" #", "leading space"],
    ["#a", "a letter after #"],
    ["a#", "text before #"],
    ["#tag", "a tag"],
    ["＃", "full-width #"],
    ["#​", "zero-width space"],
    ["😀#", "emoji before #"],
    ["1.", "a number: already reads as an item"],
    ["  #", "indented #"],
    ["- [", "half a task box"],
    [">>", "two >"],
  ])("%j is no trigger (%s)", (before) => {
    expect(matchLineTrigger(before)).toBeNull();
  });
});

describe("line bounds", () => {
  it.each([
    ["abc", 2, 0, 3],
    ["ab\ncd", 4, 3, 5],
    ["ab\ncd\nef", 3, 3, 5],
    ["ab\n", 3, 3, 3],
    ["标题\n# 中文", 5, 3, 7],
  ])("%j caret %i: line %i..%i", (value, caret, start, end) => {
    expect(lineStart(value, caret)).toBe(start);
    expect(lineEnd(value, caret)).toBe(end);
  });
});

describe("matchLineTrigger: lists, tasks, quotes", () => {
  it.each([
    ["-", "•"],
    ["*", "•"],
    ["+", "•"],
    ["    -", "    •"],
    ["[]", "☐"],
    ["[ ]", "☐"],
    ["- [ ]", "☐"],
    ["-[ ]", "☐"],
    ["• [ ]", "☐"],
    ["• [x]", "☑"],
    ["[X]", "☑"],
    ["  - [x]", "  ☑"],
  ])("%j makes the marker %j", (before, marker) => {
    expect(matchLineTrigger(before)).toEqual({ kind: "list", marker });
  });

  it("> makes a quote", () => {
    expect(matchLineTrigger(">")).toEqual({ kind: "quote" });
  });
});

describe("list items", () => {
  it.each([
    ["• a", { indent: "", marker: "•", length: 2 }],
    ["    ☐ task", { indent: "    ", marker: "☐", length: 6 }],
    ["12. x", { indent: "", marker: "12.", length: 4 }],
    ["3) x", { indent: "", marker: "3)", length: 3 }],
    ["• ", { indent: "", marker: "•", length: 2 }],
  ])("%j is an item", (line, item) => {
    expect(listItemOf(line)).toEqual(item);
  });

  it.each(["•a", "a • b", "1.5 apples", "- raw dash", ""])(
    "%j is no item",
    (line) => {
      expect(listItemOf(line)).toBeNull();
    },
  );

  it.each([
    ["•", "•"],
    ["☐", "☐"],
    ["☑", "☐"],
    ["9.", "10."],
    ["1)", "2)"],
  ])("after %j comes %j", (marker, next) => {
    expect(nextMarker(marker)).toBe(next);
  });

  it.each([
    ["☐ milk", "☑ milk"],
    ["  ☑ done", "  ☐ done"],
    ["• not a task", null],
    ["plain", null],
  ])("toggle %j -> %j", (line, out) => {
    expect(toggledTask(line)).toBe(out);
  });
});
