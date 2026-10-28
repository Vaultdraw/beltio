// Pure string post-processing of MathJax SVG output. No DOM: runs in the worker.

export const FONT_PX = 20;
const DEFAULT_COLOR = "#1e1e1e";
const SVG_NS = "http://www.w3.org/2000/svg";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Hex, a plain name, or rgb()/hsl() with only digits, spaces, commas, dots, percent signs, slashes and signs. */
const safeColor = (color: string) =>
  /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|hsl)a?\(\s*[\d.%\s,/+-]{1,60}\))$/i.test(
    color,
  )
    ? color
    : DEFAULT_COLOR;

export type PostProcessed =
  | { ok: true; svg: string; width: number; height: number }
  | { ok: false; error: string };

/** MathJax SVG string (the <svg> element only) -> final, normalizeSVG-safe SVG. */
export const postProcessSvg = (raw: string, color: string): PostProcessed => {
  const open = raw.match(/<svg\b[^>]*>/);
  if (!open) {
    return { ok: false, error: "No SVG produced" };
  }
  const vb = open[0].match(
    /\sviewBox="\s*([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)\s*"/,
  );
  if (!vb) {
    return { ok: false, error: "SVG has no viewBox" };
  }
  const [minX, minY, vbW, vbH] = vb.slice(1).map(Number);
  if (![minX, minY, vbW, vbH].every(Number.isFinite) || vbW <= 0 || vbH <= 0) {
    return { ok: false, error: "SVG has an invalid viewBox" };
  }
  const width = round2((vbW * FONT_PX) / 1000);
  const height = round2((vbH * FONT_PX) / 1000);
  const newOpen = `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="${minX} ${minY} ${vbW} ${vbH}">`;

  let body = raw.slice((open.index ?? 0) + open[0].length);
  const end = body.lastIndexOf("</svg>");
  if (end >= 0) {
    body = body.slice(0, end);
  }
  body = body
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/g, "")
    .replace(/<desc\b[^>]*>[\s\S]*?<\/desc>/g, "")
    .replace(/\s(?:data-[\w:.-]+|role|focusable|aria-[\w-]+)="[^"]*"/g, "")
    .replace(/currentColor/g, safeColor(color));

  return { ok: true, svg: `${newOpen}${body}</svg>`, width, height };
};

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
