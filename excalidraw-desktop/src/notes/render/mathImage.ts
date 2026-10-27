/** Helpers for showing a rendered formula (`renderMath`) as an image in the notes view. */

/** The font size (px) the formula renderer draws at; a note scales it to its own font. */
export const MATH_FONT_PX = 20;

const toBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
};

/** UTF-8 safe `data:image/svg+xml;base64,...` */
export const svgToDataURL = (svg: string): string =>
  `data:image/svg+xml;base64,${toBase64(new TextEncoder().encode(svg))}`;
