/** User-facing text for a native PDF error (the `code` of the error `ctx.pdf` throws). */
export const pdfErrorMessage = (err: unknown): string => {
  const code = (err as { code?: unknown } | null)?.code;
  switch (code) {
    case "PDF_ENCRYPTED":
      return "This PDF is password-protected.";
    case "PDF_BAD_PASSWORD":
      return "Wrong password. Try again.";
    case "PDF_INVALID":
      return "Not a readable PDF.";
    case "PDF_TOO_LARGE":
      return "This PDF is too large to import.";
    case "PDF_UNAVAILABLE":
      return "PDF import is not available on this system.";
    case "READ_ONLY":
      return "The drawing is read-only.";
    case "TOO_LARGE":
      return "The pages do not fit in the drawing's size limit.";
    default:
      return "Couldn't import the PDF.";
  }
};

/** Thrown when the user cancels (or the drawing changes) mid-import. */
export class PdfImportAborted extends Error {
  constructor() {
    super("PDF import cancelled");
    this.name = "PdfImportAborted";
  }
}
