/**
 * The editor's own text measure and wrap for the update pass (reflow.ts), so re-wrapped lines
 * are the lines the editor draws. Fonts must be loaded first (`loadFamilies`): a family still
 * loading measures in a fallback font.
 */
import { getFontString } from "@excalidraw/common";
import { getLineWidth, wrapText } from "@excalidraw/element";
import { Fonts } from "@excalidraw/excalidraw/fonts/Fonts";

import type {
  ExcalidrawElement,
  FontFamilyValues,
} from "@excalidraw/element/types";

import type { TextMeasure } from "./reflow";

const font = (fontFamily: number, fontSize: number) =>
  getFontString({ fontFamily: fontFamily as FontFamilyValues, fontSize });

export const editorMeasure: TextMeasure = {
  width: (text, fontFamily, fontSize) =>
    text === "" ? 0 : getLineWidth(text, font(fontFamily, fontSize)),
  wrap: (text, fontFamily, fontSize, maxWidth) =>
    wrapText(text, font(fontFamily, fontSize), maxWidth).split("\n"),
};

/** Loads the faces of these families (for `text`'s characters) before measuring. */
export const loadFamilies = async (
  families: readonly number[],
  text = "abc",
): Promise<void> => {
  const probes = [...new Set(families)].map(
    (fontFamily) =>
      ({
        type: "text",
        fontFamily,
        text,
        originalText: text,
        isDeleted: false,
      } as unknown as ExcalidrawElement),
  );
  await Fonts.loadElementsFonts(probes);
};

/**
 * The same measure for a quick check while fonts may still be loading (opening a note): a line
 * in a font that is not loaded yet counts as fitting, so a fallback face never reports clipping
 * that the real font does not have.
 */
export const loadedFontMeasure: TextMeasure = {
  width: (text, fontFamily, fontSize) => {
    const f = font(fontFamily, fontSize);
    try {
      if (!document.fonts.check(f, text)) {
        return 0;
      }
    } catch {
      return 0;
    }
    return editorMeasure.width(text, fontFamily, fontSize);
  },
  wrap: editorMeasure.wrap,
};
