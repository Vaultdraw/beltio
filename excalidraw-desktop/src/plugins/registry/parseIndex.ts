/** Reads and checks the plugins `index.json`. Bad entries are skipped; a bad file is an error. */

import { InstallError } from "../../theme/install/types";

import type { RegistryEntry } from "./types";

export const MAX_ENTRIES = 2000;
const ID = /^[a-z0-9][a-z0-9-]{1,38}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA = /^[0-9a-f]{64}$/;

const text = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** An https address, or a relative path without `..`, backslash or scheme. */
const isPackageUrl = (v: unknown): v is string => {
  if (typeof v !== "string" || v.length === 0 || v.length > 500) {
    return false;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && !u.username && !u.password;
    } catch {
      return false;
    }
  }
  return (
    !v.startsWith("/") &&
    !v.includes("\\") &&
    v.split("/").every((s) => s !== "" && s !== "." && s !== "..")
  );
};

const isHttps = (v: unknown): v is string => {
  try {
    return typeof v === "string" && new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

const parseEntry = (raw: unknown): RegistryEntry | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const name = text(r.name, 80);
  if (
    typeof r.id !== "string" ||
    !ID.test(r.id) ||
    !name ||
    typeof r.version !== "string" ||
    !SEMVER.test(r.version) ||
    typeof r.sha256 !== "string" ||
    !SHA.test(r.sha256) ||
    !isPackageUrl(r.url) ||
    !Array.isArray(r.permissions) ||
    r.permissions.length > 30 ||
    !r.permissions.every((p) => typeof p === "string" && p.length <= 60) ||
    typeof r.api !== "number" ||
    !Number.isInteger(r.api) ||
    r.api < 0
  ) {
    return null;
  }
  const entry: RegistryEntry = {
    id: r.id,
    name,
    author: text(r.author, 80),
    description: text(r.description, 300),
    version: r.version,
    api: r.api,
    permissions: [...(r.permissions as string[])],
    sha256: r.sha256,
    url: r.url,
  };
  if (typeof r.min_app === "string" && SEMVER.test(r.min_app)) {
    entry.minApp = r.min_app;
  }
  if (typeof r.size === "number" && Number.isInteger(r.size) && r.size >= 0) {
    entry.size = r.size;
  }
  if (isHttps(r.homepage)) {
    entry.homepage = r.homepage;
  }
  const licence = text(r.licence, 60);
  if (licence) {
    entry.licence = licence;
  }
  return entry;
};

export const parseRegistryIndex = (json: string): RegistryEntry[] => {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new InstallError(
      "INVALID_INDEX",
      "The plugins list is not valid JSON",
    );
  }
  const file = data as { schema?: unknown; plugins?: unknown } | null;
  if (!file || typeof file !== "object" || !Array.isArray(file.plugins)) {
    throw new InstallError(
      "INVALID_INDEX",
      "The plugins list has no `plugins` array",
    );
  }
  if (file.schema !== 1) {
    throw new InstallError(
      "INVALID_INDEX",
      "The plugins list is in a format this app does not know. Update Vaultdraw.",
    );
  }
  const seen = new Set<string>();
  const entries: RegistryEntry[] = [];
  for (const raw of file.plugins.slice(0, MAX_ENTRIES)) {
    const entry = parseEntry(raw);
    if (entry && !seen.has(entry.id)) {
      seen.add(entry.id);
      entries.push(entry);
    }
  }
  return entries;
};
