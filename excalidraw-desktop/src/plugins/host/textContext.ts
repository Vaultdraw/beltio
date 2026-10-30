/**
 * `ctx.text` and `ctx.fonts`: the editor's own text measure (the canvas
 * provider that `wrapText` uses) and its font loader. Built on first read.
 */
import {
  FONT_FAMILY,
  boldFontOf,
  getFontString,
  getLineHeight,
} from "@excalidraw/common";
import { getLineWidth } from "@excalidraw/element";
import { Fonts } from "@excalidraw/excalidraw/fonts/Fonts";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { foldKey } from "../../../../sdk/api/shared/fold";
import { PluginApiError } from "../../../../sdk/api/shared/rules";
import {
  FONT_TIMEOUT_MS,
  checkFamilies,
  checkFamily,
  checkFoldText,
  checkFont,
  checkStrings,
} from "../../../../sdk/api/shared/text";

import type { FontsApi, TextApi } from "../api";

export function createTextApi(): TextApi {
  return {
    measure(font, strings) {
      const { family, size, bold } = checkFont(font);
      const list = checkStrings(strings);
      const css = getFontString({
        fontSize: size,
        fontFamily: bold
          ? boldFontOf(FONT_FAMILY[family])
          : FONT_FAMILY[family],
      });
      const out = new Float64Array(list.length);
      for (let i = 0; i < list.length; i++) {
        out[i] = list[i] === "" ? 0 : getLineWidth(list[i], css);
      }
      return out;
    },
    lineHeight: (family) => getLineHeight(FONT_FAMILY[checkFamily(family)]),
    fold: (text) => foldKey(checkFoldText(text)),
  };
}

export function createFontsApi(doc: Document = document): FontsApi {
  return {
    async ensure(families, text) {
      const req = checkFamilies(families, text);
      if (!req.families.length) {
        return;
      }
      // Fonts loads the faces (and script subsets) that text elements need.
      const probes = req.families.map(
        (family) =>
          ({
            type: "text",
            fontFamily: FONT_FAMILY[family],
            originalText: req.text,
            text: req.text,
            isDeleted: false,
          } as unknown as ExcalidrawElement),
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new PluginApiError(
                "FONT_UNAVAILABLE",
                `Fonts not ready after ${
                  FONT_TIMEOUT_MS / 1000
                } s: ${req.families.join(", ")}`,
              ),
            ),
          FONT_TIMEOUT_MS,
        );
      });
      try {
        await Promise.race([Fonts.loadElementsFonts(probes, doc), timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
