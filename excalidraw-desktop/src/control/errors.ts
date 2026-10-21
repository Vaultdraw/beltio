export type ControlErrorCode =
  | "UNAVAILABLE"
  | "NOT_FOUND"
  | "NOT_READY"
  | "NO_VAULT"
  | "READ_ONLY"
  | "CONFLICT"
  | "INVALID_PARAMS"
  | "IO_ERROR"
  // The app's own native codes (NOT_EMPTY, TRASH_FAILED, ...) pass through.
  | (string & {});

export class ControlError extends Error {
  constructor(
    readonly code: ControlErrorCode,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

/** A repository rejection {code, message} keeps its native code; anything else is IO_ERROR. */
export const toControlError = (e: unknown): ControlError => {
  if (e instanceof ControlError) {
    return e;
  }
  const code = (e as { code?: unknown } | null)?.code;
  const message = e instanceof Error ? e.message : (e as any)?.message;
  if (typeof code === "string" && code !== "") {
    return new ControlError(code, String(message ?? code));
  }
  return new ControlError(
    "IO_ERROR",
    typeof message === "string" ? message : String(e),
  );
};
