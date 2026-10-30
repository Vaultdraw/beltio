/**
 * The vault path and permission rules the app's host and the mock host share:
 * the path checks (the same cases as the Rust side's `check_plugin_path`, tied
 * by sdk/api/test/vault-paths.json) and the permission refusal.
 */
import { PluginApiError, utf8Length } from "./rules";

import type { PluginPermission } from "@vaultdraw/api";

export const MAX_PLUGIN_PATH = 1024;
const MAX_SEGMENT = 255;
const DRAWING_SUFFIX = ".excalidraw";
const META_DIR = ".excalidraw-vault";
const RESERVED = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);
const BAD_CHARS = /[<>:"|?*]/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const shown = (name: string) =>
  `"${name.length > 40 ? `${name.slice(0, 37)}...` : name}"`;

/**
 * Why one path component is refused, in plain words, or null when it is fine. The same rules and
 * words as the Rust side's `component_problem` (paths.rs; one table, contract/name_rules.json).
 * Reserved Windows names are refused on purpose, on every system, so a vault opens everywhere.
 */
export const nameProblem = (part: string): string | null => {
  if (part === "") {
    return "A name cannot be empty";
  }
  if (part === "." || part === "..") {
    return "A name cannot be only dots";
  }
  if (utf8Length(part) > MAX_SEGMENT) {
    return `The name ${shown(part)} is too long: ${utf8Length(
      part,
    )} bytes, and the limit is ${MAX_SEGMENT}`;
  }
  if (part.endsWith(".") || part.endsWith(" ")) {
    return `The name ${shown(
      part,
    )} ends with a dot or a space, which Windows cannot hold`;
  }
  if (CONTROL.test(part)) {
    return `The name ${shown(part)} has a control character in it`;
  }
  const bad = BAD_CHARS.exec(part);
  if (bad) {
    return `The character ${bad[0]} is not allowed in a name (${shown(part)})`;
  }
  const stem = part.split(".")[0].toUpperCase();
  if (RESERVED.has(stem)) {
    return `${stem} is a reserved Windows name, so Vaultdraw refuses it on every system to keep vaults portable (${shown(
      part,
    )})`;
  }
  return null;
};

const invalid = (message: string) =>
  new PluginApiError("INVALID_PATH", message);

/** `image`: an export file (`.svg` or `.png`); `imageFolder`: a folder of exports (not the root). */
export type VaultPathKind = "file" | "folder" | "image" | "imageFolder";

const IMAGE_SUFFIXES = [".svg", ".png"];

/**
 * Throws INVALID_PATH unless `path` is acceptable for a plugin call. A file
 * must be a `.excalidraw` drawing; a folder may be empty (the vault root).
 * Whether the entry exists is decided by the call that follows.
 */
export const checkVaultPath = (path: unknown, kind: VaultPathKind): string => {
  if (typeof path !== "string") {
    throw new PluginApiError("INVALID_ARGUMENT", "A path must be a string");
  }
  if (path === "") {
    if (kind === "folder") {
      return path;
    }
    throw invalid(
      kind === "file" ? "A drawing path is required" : "A path is required",
    );
  }
  if (utf8Length(path) > MAX_PLUGIN_PATH) {
    throw invalid("Path is longer than 1024 bytes");
  }
  const parts = path.split("/");
  if (parts.some((s) => s.startsWith("."))) {
    throw invalid(
      "Plugins cannot use paths with a segment that starts with a dot",
    );
  }
  if (kind === "file" && !path.toLowerCase().endsWith(DRAWING_SUFFIX)) {
    throw invalid("Drawing paths must end in .excalidraw");
  }
  if (
    kind === "image" &&
    !IMAGE_SUFFIXES.some((x) => path.toLowerCase().endsWith(x))
  ) {
    throw invalid("Exports end in .svg or .png");
  }
  if (path.includes("\\") || path.includes("\0")) {
    throw invalid(
      "Path must be a bounded vault-relative path using forward slashes",
    );
  }
  for (const part of parts) {
    const problem = nameProblem(part);
    if (problem) {
      throw invalid(problem);
    }
    if (part.toLowerCase() === META_DIR) {
      throw invalid("Reserved vault metadata is not user-accessible");
    }
  }
  return path;
};

/** The PERMISSION error of a call whose permission plugin.toml does not declare. */
export const permissionError = (
  pluginId: string,
  method: string,
  permission: PluginPermission,
): PluginApiError =>
  Object.assign(
    new PluginApiError(
      "PERMISSION",
      `${pluginId}: ${method} needs the permission "${permission}", which plugin.toml does not declare`,
    ),
    { permission },
  );

/** Throws PERMISSION unless `declared` holds `permission`. */
export const requirePermission = (
  pluginId: string,
  declared: readonly string[],
  method: string,
  permission: PluginPermission,
): void => {
  if (!declared.includes(permission)) {
    throw permissionError(pluginId, method, permission);
  }
};
