import { describe, expect, test } from "vitest";

import cases from "../../../../../excalidraw-desktop/src-tauri/crates/vaultdraw-core/src/markdown/alt_size_cases.json";
import { altAndSize, literalImages } from "../../src/layout/literalImages";

type Case = [
  input: string,
  alt: string,
  width: number | null,
  height: number | null,
];

/** Family: every place alt/size text is parsed reads it like Obsidian and like the Rust parser. */
describe("alt text and size (shared table with the Rust parser)", () => {
  test.each(cases as Case[])(
    "%j -> alt %j, %j x %j",
    (input, alt, width, height) => {
      expect(altAndSize(input)).toEqual({
        alt,
        ...(width !== null ? { width } : {}),
        ...(height !== null ? { height } : {}),
      });
    },
  );

  test("an image with a spaced path keeps alt text that ends in a number", () => {
    const [img] = literalImages("![Photo 3](my pics/a.png)")!;
    expect(img).toMatchObject({ kind: "image", alt: "Photo 3" });
    expect((img as { width?: number }).width).toBeUndefined();
  });
});
