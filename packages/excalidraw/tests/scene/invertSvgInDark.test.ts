import { exportToSvg } from "@excalidraw/utils";

import {
  DARK_THEME_FILTER,
  getDisplayColorTransformVersion,
  setInvertSvgImagesInDark,
  shouldInvertSvgImagesInDark,
} from "@excalidraw/common";

import type { FileId } from "@excalidraw/element/types";

import { API } from "../helpers/api";

import type { BinaryFileData, BinaryFiles } from "../../types";

/**
 * toimprove 133: Excalidraw inverts SVG pictures in the dark theme. Vaultdraw
 * keeps that by default (`appearance.invert_svg_in_dark`) and lets the host
 * turn it off, on screen and in dark exports alike.
 */
const svgFile = (mimeType: string): BinaryFiles => ({
  ["pic" as FileId]: {
    id: "pic" as FileId,
    mimeType: mimeType as BinaryFileData["mimeType"],
    dataURL:
      "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=" as BinaryFileData["dataURL"],
    created: 1,
  },
});

const filteredGroups = async (mimeType: string, dark: boolean) => {
  const image = API.createElement({
    type: "image",
    fileId: "pic" as FileId,
    status: "saved",
    width: 100,
    height: 100,
  });
  const svg = await exportToSvg({
    elements: [image],
    appState: { exportWithDarkMode: dark, exportBackground: false },
    files: svgFile(mimeType),
    skipInliningFonts: true,
  });
  return Array.from(svg.querySelectorAll("g")).filter(
    (g) => g.getAttribute("filter") === DARK_THEME_FILTER,
  ).length;
};

describe("invert SVG pictures in the dark theme (host setting)", () => {
  afterEach(() => {
    setInvertSvgImagesInDark(true);
  });

  it("is on by default, like Excalidraw: a dark export inverts an SVG picture", async () => {
    expect(shouldInvertSvgImagesInDark()).toBe(true);
    expect(await filteredGroups("image/svg+xml", true)).toBe(1);
  });

  it("never inverts in the light theme, nor a PNG in the dark one", async () => {
    expect(await filteredGroups("image/svg+xml", false)).toBe(0);
    expect(await filteredGroups("image/png", true)).toBe(0);
  });

  it("off: the SVG picture keeps its colours in the dark theme", async () => {
    setInvertSvgImagesInDark(false);
    expect(await filteredGroups("image/svg+xml", true)).toBe(0);
  });

  it("a change bumps the display version (cached canvases repaint); the same value does not", () => {
    const v = getDisplayColorTransformVersion();
    expect(setInvertSvgImagesInDark(true)).toBe(false);
    expect(getDisplayColorTransformVersion()).toBe(v);
    expect(setInvertSvgImagesInDark(false)).toBe(true);
    expect(getDisplayColorTransformVersion()).toBe(v + 1);
  });
});
