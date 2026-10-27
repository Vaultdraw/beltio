import { DRAWING_EXT } from "../vault/fileKind";

import { ControlError } from "./errors";

export const EXT = DRAWING_EXT;

export const objectParams = (params: unknown): Record<string, unknown> => {
  if (params && typeof params === "object" && !Array.isArray(params)) {
    return params as Record<string, unknown>;
  }
  throw new ControlError("INVALID_PARAMS", "params must be an object");
};

export const stringParam = (params: unknown, name: string): string => {
  const value = objectParams(params)[name];
  if (typeof value !== "string" || value === "") {
    throw new ControlError("INVALID_PARAMS", `${name} must be a string`);
  }
  return value;
};

/** A vault-relative path: no leading slash, no "." / ".." parts. "" = vault root when allowed. */
export const relPath = (
  raw: string,
  name: string,
  allowRoot = false,
): string => {
  const parts = raw.split("/").filter((p) => p !== "");
  if (parts.some((p) => p === "." || p === "..")) {
    throw new ControlError(
      "INVALID_PARAMS",
      `${name} must stay inside the vault`,
    );
  }
  if (parts.length === 0 && !allowRoot) {
    throw new ControlError("INVALID_PARAMS", `${name} must not be empty`);
  }
  return parts.join("/");
};

export const withExt = (path: string): string =>
  path.toLowerCase().endsWith(EXT) ? path : `${path}${EXT}`;

export const splitPath = (path: string): { parent: string; name: string } => {
  const i = path.lastIndexOf("/");
  return i < 0
    ? { parent: "", name: path }
    : { parent: path.slice(0, i), name: path.slice(i + 1) };
};

export const joinRel = (parent: string, name: string): string =>
  parent ? `${parent}/${name}` : name;

/** `to` ending in "/" means "into that folder, keeping the name". */
export const moveDestination = (from: string, to: string): string => {
  const dest = relPath(to, "to", true);
  return to.endsWith("/") || dest === ""
    ? joinRel(dest, splitPath(from).name)
    : dest;
};

/** Optional boolean: absent = `fallback`, anything but a boolean is invalid. */
export const boolParam = (
  params: unknown,
  name: string,
  fallback: boolean,
): boolean => {
  const value = objectParams(params)[name];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new ControlError("INVALID_PARAMS", `${name} must be a boolean`);
  }
  return value;
};

export const exportFormatParam = (params: unknown): "png" | "svg" | "pdf" => {
  const value = objectParams(params).format;
  if (value === "png" || value === "svg" || value === "pdf") {
    return value;
  }
  throw new ControlError("INVALID_PARAMS", "format must be png, svg or pdf");
};

/** Export scale 1..3 (the dialog offers 1, 2, 3; halves are fine). Default 1. */
export const exportScaleParam = (params: unknown): number => {
  const value = objectParams(params).scale;
  if (value === undefined) {
    return 1;
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 1 ||
    value > 3
  ) {
    throw new ControlError(
      "INVALID_PARAMS",
      "scale must be a number from 1 to 3",
    );
  }
  return value;
};

/** Optional non-empty string: absent = undefined, anything else but a string is invalid. */
export const optionalStringParam = (
  params: unknown,
  name: string,
): string | undefined => {
  const value = objectParams(params)[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value === "") {
    throw new ControlError("INVALID_PARAMS", `${name} must be a string`);
  }
  return value;
};

/** Export canvas padding 0..200 px. Absent = undefined (the editor's default). */
export const exportPaddingParam = (params: unknown): number | undefined => {
  const value = objectParams(params).padding;
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 200
  ) {
    throw new ControlError(
      "INVALID_PARAMS",
      "padding must be a number from 0 to 200",
    );
  }
  return value;
};
