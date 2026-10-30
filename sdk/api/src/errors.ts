/**
 * The codes of the errors the app throws from the API. A plugin reads `error.code`
 * and always keeps a default branch: a minor release may add a code.
 *
 * @since 1.0.0
 */
export type PluginErrorCode =
  | "CONFLICT"
  | "DRAWING_CHANGED"
  | "FONT_UNAVAILABLE"
  | "INVALID_ARGUMENT"
  | "INVALID_FILE"
  | "INVALID_PATH"
  | "IO_ERROR"
  | "NAME_COLLISION"
  | "NETWORK_ERROR"
  | "NETWORK_NOT_ALLOWED"
  | "NO_VAULT"
  | "NO_VERSION"
  | "NOT_FOUND"
  | "NOT_SUPPORTED"
  | "PERMISSION"
  | "QUOTA"
  | "READ_ONLY"
  | "TIMEOUT"
  | "TOO_LARGE";

/**
 * What a refused call rejects or throws with. Check it with
 * `isPluginApiError(e)` style code: `e instanceof Error && "code" in e`.
 * `issues` is set for `ctx.scene.batch` refusals.
 *
 * @since 1.0.0
 */
export interface PluginApiError extends Error {
  readonly name: "PluginApiError";
  readonly code: PluginErrorCode;
  readonly issues?: readonly import("./scene").SceneOpIssue[];
}
