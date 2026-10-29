import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import {
  BOLD_FONT_OFFSET,
  FONT_FAMILY,
  boldFontOf,
  getFontString,
  getFontFamilyString,
  getLineHeight,
  isBoldFont,
  regularFontOf,
} from "./index";

describe("bold font variants", () => {
  const boldable = [1, 2, 3, 5, 6, 8, 9];

  it("map a regular id to regular + 100 and back", () => {
    for (const id of boldable) {
      expect(boldFontOf(id)).toBe(id + BOLD_FONT_OFFSET);
      expect(isBoldFont(id + BOLD_FONT_OFFSET)).toBe(true);
      expect(regularFontOf(id + BOLD_FONT_OFFSET)).toBe(id);
      expect(isBoldFont(id)).toBe(false);
    }
  });

  it("leave Lilita One, Assistant and unknown ids alone", () => {
    for (const id of [
      FONT_FAMILY["Lilita One"],
      FONT_FAMILY.Assistant,
      4,
      77,
    ]) {
      expect(boldFontOf(id)).toBe(id);
      expect(isBoldFont(id)).toBe(false);
    }
    expect(isBoldFont(107)).toBe(false);
    expect(regularFontOf(210)).toBe(210);
  });

  it("the font string asks for the bold weight of the same family stack", () => {
    for (const id of boldable) {
      expect(getFontString({ fontSize: 20, fontFamily: id + 100 })).toBe(
        `bold ${getFontString({ fontSize: 20, fontFamily: id })}`,
      );
      expect(getFontFamilyString({ fontFamily: id + 100 })).toBe(
        getFontFamilyString({ fontFamily: id }),
      );
      expect(getLineHeight(id + 100)).toBe(getLineHeight(id));
    }
  });

  it("an unknown id (excalidraw.com's view of a bold text) falls back to a system font, not an error", () => {
    expect(getFontFamilyString({ fontFamily: 777 })).toBeTruthy();
    expect(getFontString({ fontSize: 16, fontFamily: 777 })).toMatch(/^16px /);
  });
});

describe("bold font strings in the editor's measure", () => {
  it("measureText reads the size after the weight: a finite height equal to the regular one", async () => {
    const { measureText } = await import("@excalidraw/element");
    const regular = measureText(
      "Title\nTwo",
      getFontString({ fontSize: 40, fontFamily: 5 }),
      1.25 as ExcalidrawTextElement["lineHeight"],
    );
    const bold = measureText(
      "Title\nTwo",
      getFontString({ fontSize: 40, fontFamily: 105 }),
      1.25 as ExcalidrawTextElement["lineHeight"],
    );
    expect(Number.isFinite(bold.height)).toBe(true);
    expect(bold.height).toBe(regular.height);
    expect(Number.isFinite(bold.width)).toBe(true);
  });
});
