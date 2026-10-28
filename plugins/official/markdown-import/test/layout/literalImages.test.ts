import { describe, expect, test } from "vitest";

import { htmlImages, literalImages } from "../../src/layout/literalImages";

describe("images the parser leaves as text", () => {
  test("![alt](path with spaces.png) becomes an image, %20 decoded, size from alt|w", () => {
    expect(literalImages("![shot|300](my pics/a%20b.png)")).toEqual([
      {
        kind: "image",
        target: "my pics/a b.png",
        remote: false,
        alt: "shot",
        width: 300,
      },
    ]);
  });
  test("angle brackets, a title, text around, two in a row", () => {
    const p = literalImages("see ![](<a b.png>) and ![x](c d.png) end")!;
    expect(p.map((x) => x.kind)).toEqual([
      "text",
      "image",
      "text",
      "image",
      "text",
    ]);
  });
  test("a target without spaces is left alone (the parser took it)", () => {
    expect(literalImages("![x](a.png)")).toBeNull();
    expect(literalImages("no images here")).toBeNull();
  });
  test("raw <img> tags", () => {
    expect(
      htmlImages('<img src="https://x.org/a.png" alt="A" width="200">'),
    ).toEqual([
      {
        kind: "image",
        target: "https://x.org/a.png",
        remote: true,
        alt: "A",
        width: 200,
      },
    ]);
    expect(htmlImages("<div>hi</div>")).toBeNull();
    expect(htmlImages('<img src="a.png"> text')).toBeNull();
  });
});
