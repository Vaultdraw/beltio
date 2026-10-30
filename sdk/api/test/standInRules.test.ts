/**
 * The plugin API's note parse stand-in (`shared/markdown.ts`) gives the same answers as the app for the
 * rules the app owns: what a `#tag` is (`shared/tagGrammar.ts`) and the `alt|size` of a picture
 * (`shared/imageSize.ts`). It has no copy of either (the guard tests in excalidraw-desktop fail on one).
 */
import { describe, expect, it } from "vitest";

import { fakeParseMarkdown } from "../shared/markdown";

import type { NoteBlock } from "../src/markdown";

const tags = (text: string) => fakeParseMarkdown(text).tags;
const image = (text: string) =>
  fakeParseMarkdown(text).blocks.find((b) => b.kind === "image") as
    | (NoteBlock & { kind: "image" })
    | undefined;

describe("stand-in tags follow the app's grammar", () => {
  it.each([
    ["a #todo here", ["todo"]],
    ["(#opened) and, #after", ["opened", "after"]],
    ["colour #ff00aa and #fff", ["fff"]],
    ["#2024 and #v2", ["v2"]],
    ["#Über/ünder", ["Über/ünder"]],
    ["not#attached", []],
    ["#one #ONE", ["one"]],
  ])("%s", (text, want) => {
    expect(tags(text)).toEqual(want);
  });
});

describe("stand-in picture sizes follow altAndSize", () => {
  it("wikilink: alt, width and height", () => {
    expect(image("![[a.png|caption|300x200]]")).toMatchObject({
      target: "a.png",
      alt: "caption",
      width: 300,
      height: 200,
    });
    expect(image("![[a.png|300]]")).toMatchObject({ width: 300 });
    expect(image("![[a.png|Photo 3]]")).toMatchObject({ alt: "Photo 3" });
    expect(image("![[a.png| 300 ]]")).toMatchObject({ width: 300 });
  });
  it("markdown picture: the size rides in the alt", () => {
    expect(image("![caption|300x200](a.png)")).toMatchObject({
      alt: "caption",
      width: 300,
      height: 200,
    });
    expect(image("![plain alt](a.png)")).toMatchObject({ alt: "plain alt" });
  });
});
