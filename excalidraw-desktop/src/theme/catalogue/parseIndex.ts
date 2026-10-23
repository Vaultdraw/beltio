/** Reads and checks `index.json`. Bad entries are skipped; a bad file is an error. */

import { InstallError } from "../install/types";

import type { CatalogueEntry, ThemeMode } from "./types";

export const MAX_ENTRIES = 2000;
const MAX_NAME = 80;
const MAX_TEXT = 300;

const SHA = /^[0-9a-f]{64}$/;
const COLOUR = /^#[0-9a-f]{3,8}$/i;

const text = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** A relative path inside the repo: no `..`, no leading slash, no backslash, no scheme. */
export const isSafePath = (path: unknown, ext: RegExp): path is string =>
  typeof path === "string" &&
  path.length > 0 &&
  path.length <= 200 &&
  ext.test(path) &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  !path.includes(":") &&
  !path.includes("?") &&
  !path.includes("#") &&
  path.split("/").every((s) => s !== "" && s !== "." && s !== "..");

const isHttps = (v: unknown): v is string => {
  if (typeof v !== "string") {
    return false;
  }
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

const strings = (v: unknown, max: number, each: number): string[] =>
  Array.isArray(v)
    ? v
        .map((s) => text(s, each))
        .filter(Boolean)
        .slice(0, max)
    : [];

const modeOf = (v: unknown): ThemeMode | null =>
  v === "dark" || v === "light" ? v : null;

const parseEntry = (raw: unknown): CatalogueEntry | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const name = text(r.name, MAX_NAME);
  if (
    !name ||
    !isSafePath(r.path, /\.json$/i) ||
    typeof r.sha256 !== "string" ||
    !SHA.test(r.sha256)
  ) {
    return null;
  }
  const swatchIn =
    r.swatch && typeof r.swatch === "object"
      ? (r.swatch as Record<string, unknown>)
      : {};
  const swatch: CatalogueEntry["swatch"] = {};
  for (const mode of ["dark", "light"] as const) {
    const colours = strings(swatchIn[mode], 6, 9).filter((c) => COLOUR.test(c));
    if (colours.length > 0) {
      swatch[mode] = colours;
    }
  }
  const modes = (Array.isArray(r.modes) ? r.modes : [])
    .map(modeOf)
    .filter((m): m is ThemeMode => m !== null);
  const entry: CatalogueEntry = {
    name,
    path: r.path,
    author: text(r.author, 80),
    description: text(r.description, MAX_TEXT),
    tags: strings(r.tags, 12, 30),
    modes: modes.length > 0 ? modes : (Object.keys(swatch) as ThemeMode[]),
    swatch,
    sha256: r.sha256,
    previews: (Array.isArray(r.previews) ? r.previews : [])
      .filter((p): p is string => isSafePath(p, /\.(png|jpe?g|webp)$/i))
      .slice(0, 3),
  };
  const credit = text(r.credit, 120);
  const licence = text(r.licence, 120);
  if (credit) {
    entry.credit = credit;
  }
  if (licence) {
    entry.licence = licence;
  }
  if (isHttps(r.homepage) && r.homepage.length <= 300) {
    entry.homepage = r.homepage;
  }
  return entry;
};

/** Entries of an index file. Throws InstallError INVALID_INDEX or INDEX_VERSION. */
export const parseIndex = (json: string): CatalogueEntry[] => {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new InstallError(
      "INVALID_INDEX",
      "The themes list is not valid JSON",
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new InstallError(
      "INVALID_INDEX",
      "The themes list has the wrong shape",
    );
  }
  const { schemaVersion, themes } = data as Record<string, unknown>;
  if (schemaVersion !== 1) {
    throw new InstallError(
      "INDEX_VERSION",
      "This themes list needs a newer Vaultdraw",
    );
  }
  if (!Array.isArray(themes)) {
    throw new InstallError("INVALID_INDEX", "The themes list has no themes");
  }
  const seen = new Set<string>();
  const out: CatalogueEntry[] = [];
  for (const item of themes.slice(0, MAX_ENTRIES)) {
    const entry = parseEntry(item);
    const key = entry?.name.toLowerCase();
    if (entry && key && !seen.has(key)) {
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
};
