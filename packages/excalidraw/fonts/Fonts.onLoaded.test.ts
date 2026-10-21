import { FONT_FAMILY } from "@excalidraw/common";
import { newTextElement, Scene, syncInvalidIndices } from "@excalidraw/element";
import { vi } from "vitest";

import { Fonts } from "./Fonts";

const face = (family: string, unicodeRange = "U+0-10FFFF") =>
  ({ family, style: "normal", weight: "400", unicodeRange } as FontFace);

const text = (fontFamily: number) =>
  newTextElement({ x: 0, y: 0, text: "hi", fontFamily: fontFamily as any });

describe("Fonts.onLoaded", () => {
  beforeEach(() => {
    Fonts.loadedFontsCache.clear();
  });

  const setup = () => {
    const scene = new Scene();
    scene.replaceAllElements(syncInvalidIndices([text(FONT_FAMILY.Nunito)]));
    const triggerUpdate = vi.spyOn(scene, "triggerUpdate");
    return { fonts: new Fonts(scene), triggerUpdate };
  };

  it("does not redraw the scene for a font none of its text uses", () => {
    const { fonts, triggerUpdate } = setup();
    fonts.onLoaded([face("Comic Shanns")]);
    expect(triggerUpdate).not.toHaveBeenCalled();
  });

  it("redraws when a font of the scene's text loads (quoted family too)", () => {
    const { fonts, triggerUpdate } = setup();
    fonts.onLoaded([face('"Nunito"')]);
    expect(triggerUpdate).toHaveBeenCalledTimes(1);
  });

  it("redraws when a fallback in the text's font stack loads", () => {
    const { fonts, triggerUpdate } = setup();
    fonts.onLoaded([face("Segoe UI Emoji")]);
    expect(triggerUpdate).toHaveBeenCalledTimes(1);
  });

  it("bails on faces it has already processed", () => {
    const { fonts, triggerUpdate } = setup();
    fonts.onLoaded([face("Nunito")]);
    fonts.onLoaded([face("Nunito")]);
    expect(triggerUpdate).toHaveBeenCalledTimes(1);
  });
});
