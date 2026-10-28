/**
 * The size of one PDF page in points (1/72 inch), as shown: the crop box after the page's rotation.
 *
 * @since 0.26.0
 */
export interface PdfPageSize {
  /** @since 0.26.0 */
  readonly widthPt: number;
  /** @since 0.26.0 */
  readonly heightPt: number;
}

/**
 * How `PdfDocument.render` draws a page.
 *
 * @since 0.26.0
 */
export interface PdfRenderOptions {
  /** Longest side of the bitmap in pixels (64 to 8192; the bitmap is also capped at about 16 megapixels). @since 0.26.0 */
  maxSide: number;
  /** @since 0.26.0 */
  format: "jpeg" | "png";
  /** JPEG quality, 0 to 1; ignored for PNG. @since 0.26.0 */
  quality: number;
}

/**
 * An open PDF. The app keeps it open natively (at most four at a time; the oldest is closed when
 * a fifth opens), so call `close()` when done.
 *
 * @since 0.26.0
 */
export interface PdfDocument {
  /** The file name only. @since 0.26.0 */
  readonly name: string;
  /** 0 while `locked`. @since 0.26.0 */
  readonly pageCount: number;
  /** Empty while `locked`. @since 0.26.0 */
  readonly pages: readonly PdfPageSize[];
  /** @since 0.26.0 */
  readonly byteSize: number;
  /** Encrypted and the empty password failed: call `unlock`. @since 0.26.0 */
  readonly locked: boolean;
  /**
   * One page (0-based) as encoded image bytes. Renders run one at a time. Rejects with
   * `PDF_PAGE_FAILED` when the page cannot be drawn, `PDF_BAD_TOKEN` when the document was closed.
   *
   * @since 0.26.0
   */
  render(index: number, options: PdfRenderOptions): Promise<Uint8Array>;
  /**
   * Tries a password. Resolves with the unlocked document (the same one, with its pages); rejects
   * with `PDF_BAD_PASSWORD` when it is wrong.
   *
   * @since 0.26.0
   */
  unlock(password: string): Promise<PdfDocument>;
  /** Releases the native document. Safe to call twice. @since 0.26.0 */
  close(): Promise<void>;
}

/**
 * The `[pdf_import]` settings of `config.toml`, read at call time (a change applies to the next
 * import). Every value is already checked and clamped.
 *
 * @since 0.26.0
 */
export interface PdfImportSettings {
  /** Longest side of an imported page image, in pixels. @since 0.26.0 */
  maxSide: number;
  /** @since 0.26.0 */
  format: "jpeg" | "png";
  /** @since 0.26.0 */
  quality: number;
  /** Lock the imported pages so annotating does not drag them. @since 0.26.0 */
  lockPages: boolean;
  /** Warn before importing more pages than this. @since 0.26.0 */
  warnPages: number;
  /** Decoded-pixel budget of one import, in megapixels. @since 0.26.0 */
  pixelBudgetMp: number;
}

/**
 * Open PDF files and draw their pages with the app's native renderer (PDFKit on macOS, poppler on
 * Linux). Needs the permission `pdf`. Errors carry a `code`: `PDF_ENCRYPTED`, `PDF_BAD_PASSWORD`,
 * `PDF_INVALID`, `PDF_PAGE_FAILED`, `PDF_BAD_TOKEN`, `PDF_TOO_LARGE`, `PDF_UNAVAILABLE`.
 *
 * @since 0.26.0
 */
export interface PdfApi {
  /** A native file dialog; null when the user cancels. @since 0.26.0 */
  pick(): Promise<PdfDocument | null>;
  /** Opens PDF bytes, such as a dropped file (up to 128 MiB). @since 0.26.0 */
  open(name: string, bytes: Uint8Array): Promise<PdfDocument>;
  /** The `[pdf_import]` settings now. @since 0.26.0 */
  settings(): PdfImportSettings;
}
