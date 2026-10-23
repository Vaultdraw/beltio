/**
 * Typed export failures, so callers branch on a code instead of a message:
 * EMPTY (nothing to export) and INVALID_FILE (the file is not a drawing).
 */
export type ExportErrorCode = "EMPTY" | "INVALID_FILE";

export class ExportError extends Error {
  constructor(readonly code: ExportErrorCode, message: string) {
    super(message);
    this.name = "ExportError";
  }
}

export const emptyCanvasError = () =>
  new ExportError("EMPTY", "Cannot export an empty canvas.");
