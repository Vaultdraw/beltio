/**
 * The `[pdf_import]` settings: the values, defaults and limits the config, Settings and the
 * Files page share. The import itself is the official pdf-import plugin
 * (plugins/official/pdf-import), which reads them through `ctx.pdf.settings()`.
 */

export type PdfImageFormat = "jpeg" | "png";

export type PdfImportSettings = {
  /** Upper bound for the rendered long side, in pixels. */
  maxSide: number;
  format: PdfImageFormat;
  quality: number;
  /** Imported pages are locked so annotating doesn't drag them. */
  lockPages: boolean;
  /** Show a size/memory warning above this many pages. */
  warnPages: number;
  /** Decoded-pixel budget per import, in megapixels (adapts the resolution). */
  pixelBudgetMp: number;
};

export const DEFAULT_PDF_IMPORT_SETTINGS: PdfImportSettings = {
  maxSide: 1440,
  format: "jpeg",
  quality: 0.85,
  lockPages: true,
  warnPages: 50,
  pixelBudgetMp: 60,
};

export const PDF_IMPORT_LIMITS = {
  maxSide: { min: 600, max: 3000 },
  quality: { min: 0.5, max: 1 },
  warnPages: { min: 1, max: 500 },
  pixelBudgetMp: { min: 10, max: 400 },
} as const;
