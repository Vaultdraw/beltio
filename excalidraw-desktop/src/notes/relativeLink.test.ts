import { describe, expect, it } from "vitest";

import { resolveRelativeHref } from "./relativeLink";

const paths = [
  "n.md",
  "Other.md",
  "My Page.md",
  "Sub/Deep.md",
  "Sub/Plan.excalidraw",
];

describe("resolveRelativeHref", () => {
  it.each([
    ["n.md", "Other.md", "Other.md", null],
    ["n.md", "My%20Page.md", "My Page.md", null],
    ["n.md", "Sub/Deep.md#Part%20One", "Sub/Deep.md", "Part One"],
    ["Sub/Deep.md", "../Other.md", "Other.md", null],
    ["Sub/Deep.md", "Plan.excalidraw", "Sub/Plan.excalidraw", null],
    ["n.md", "other.md", "Other.md", null],
    ["n.md", "#Intro", "n.md", "Intro"],
  ])("%s + %s", (from, href, path, heading) => {
    expect(resolveRelativeHref(from, href, paths)).toEqual({ path, heading });
  });
  it.each([
    "https://x.org/a.md",
    "mailto:a@b.c",
    "//x/y.md",
    "Missing.md",
    "../../x.md",
    "",
  ])("%s is not a vault link", (href) => {
    expect(resolveRelativeHref("n.md", href, paths)).toBeNull();
  });
});
