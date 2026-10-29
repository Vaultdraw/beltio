import { describe, expect, it } from "vitest";

import { lineEnd, lineStart, matchLineTrigger } from "./lineRules";

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
    ["-", "list marker (slice 2)"],
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
