/**
 * Import budgets: decoded pixels (adaptive resolution) and drawing bytes
 * (the 32 MiB cap). Pure. Byte sizes are rough estimates; the importer
 * measures the real encoded size per page.
 */
import { DRAWING_BYTES_HEADROOM, LIMITS, MAX_DRAWING_BYTES } from "./limits";

import type { PdfImportSettings, PdfPageSize } from "@vaultdraw/api";

/** Rough encoded size of a JPEG page at quality 0.85, bytes per pixel. */
export const JPEG_BYTES_PER_PX = 0.12;
export const JPEG_REFERENCE_QUALITY = 0.85;
/** Rough encoded size of a PNG page (text/line art), bytes per pixel. */
export const PNG_BYTES_PER_PX = 0.5;
/** Element JSON per imported page. */
export const ELEMENT_JSON_BYTES = 250;

const ratio = (p: PdfPageSize) =>
  Math.max(p.widthPt, p.heightPt) /
  Math.max(1, Math.min(p.widthPt, p.heightPt));

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 1;
};

/** Effective long side so that all pages together stay within the pixel budget. */
export const planImportSides = (
  pages: readonly PdfPageSize[],
  indices: readonly number[],
  settings: PdfImportSettings,
): number => {
  const n = Math.max(1, indices.length);
  const r = median(indices.map((i) => ratio(pages[i])));
  const fromBudget = Math.floor(
    Math.sqrt(((settings.pixelBudgetMp * 1e6) / n) * r),
  );
  return Math.min(settings.maxSide, Math.max(LIMITS.minSide, fromBudget));
};

/** Size of a page's long side `side` in pixels: [w, h]. */
export const pagePixels = (
  page: PdfPageSize,
  side: number,
): [number, number] => {
  const long = Math.max(page.widthPt, page.heightPt, 1);
  const scale = side / long;
  return [
    Math.max(1, Math.round(page.widthPt * scale)),
    Math.max(1, Math.round(page.heightPt * scale)),
  ];
};

/** Bytes an encoded page of `encodedBytes` adds to the drawing JSON (base64 + element). */
export const pageJsonCost = (encodedBytes: number): number =>
  Math.ceil((encodedBytes * 4) / 3) + ELEMENT_JSON_BYTES;

const encodedBytesPerPx = (settings: PdfImportSettings) =>
  settings.format === "png"
    ? PNG_BYTES_PER_PX
    : JPEG_BYTES_PER_PX *
      Math.pow(settings.quality / JPEG_REFERENCE_QUALITY, 2);

export const byteBudget = (currentBytes: number): number =>
  DRAWING_BYTES_HEADROOM * MAX_DRAWING_BYTES - currentBytes;

export type ImportEstimate = {
  side: number;
  bytesPerPage: number;
  totalBytes: number;
  pagesThatFit: number;
  decodedBytes: number;
};

export const estimateImport = ({
  pages,
  indices,
  settings,
  currentBytes,
}: {
  pages: readonly PdfPageSize[];
  indices: readonly number[];
  settings: PdfImportSettings;
  currentBytes: number;
}): ImportEstimate => {
  const side = planImportSides(pages, indices, settings);
  const perPx = encodedBytesPerPx(settings);
  let remaining = byteBudget(currentBytes);
  let total = 0;
  let decoded = 0;
  let fit = 0;
  let fitting = true;
  for (const i of indices) {
    const [w, h] = pagePixels(pages[i], side);
    const cost = pageJsonCost(w * h * perPx);
    total += cost;
    decoded += w * h * 4;
    if (fitting && cost <= remaining) {
      remaining -= cost;
      fit++;
    } else {
      fitting = false;
    }
  }
  return {
    side,
    bytesPerPage: indices.length ? Math.round(total / indices.length) : 0,
    totalBytes: Math.round(total),
    pagesThatFit: fit,
    decodedBytes: decoded,
  };
};
