/** Install, update and remove themes through an InstallBackend (pure logic, no UI). */

import { parseThemeFile } from "../normalize";

import { InstallError } from "./types";

import type {
  InstallBackend,
  InstalledTheme,
  ThemeSource,
  UpdateFetch,
} from "./types";

/** A downloaded theme file and where it came from. */
export interface Candidate {
  json: string;
  source: ThemeSource;
  /** Used when the file has no `name`. */
  fallbackName: string;
}

export const kibToBytes = (kb: number) => Math.max(1, Math.min(256, kb)) * 1024;

/** Checks the file is a valid theme; returns the name it installs under. Throws InstallError. */
export const validateCandidate = (
  json: string,
  fallbackName: string,
): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InstallError("INVALID_THEME", "The file is not valid JSON");
  }
  try {
    return parseThemeFile(parsed, fallbackName).name;
  } catch (err) {
    throw new InstallError(
      "INVALID_THEME",
      err instanceof Error ? err.message : String(err),
    );
  }
};

/** Validates, then writes. `asName` installs under another name (clash resolution). */
export const installCandidate = async (
  backend: InstallBackend,
  candidate: Candidate,
  options: { replace?: boolean; asName?: string } = {},
): Promise<string> => {
  const name = validateCandidate(candidate.json, candidate.fallbackName);
  const written = await backend.write({
    name: options.asName ?? name,
    json: candidate.json,
    source: candidate.source,
    replace: options.replace ?? false,
  });
  return written.name;
};

/** "Name 2", "Name 3", ... the first not in `taken` (case-insensitive). */
export const freeName = (name: string, taken: Iterable<string>): string => {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  for (let i = 2; ; i++) {
    const next = `${name} ${i}`;
    if (!used.has(next.toLowerCase())) {
      return next;
    }
  }
};

export type UpdateStatus =
  | { name: string; state: "current" }
  | { name: string; state: "newer"; fetched: UpdateFetch }
  | { name: string; state: "failed"; message: string };

/** Checks every installed theme for a newer file. Nothing is written. */
export const checkUpdates = async (
  backend: InstallBackend,
  installed: InstalledTheme[],
  maxBytes: number,
): Promise<UpdateStatus[]> => {
  const results: UpdateStatus[] = [];
  for (const { name } of installed) {
    try {
      const fetched = await backend.updateFetch(name, maxBytes);
      results.push(
        fetched.changed && fetched.json
          ? { name, state: "newer", fetched }
          : { name, state: "current" },
      );
    } catch (err) {
      results.push({
        name,
        state: "failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
};

/** Writes a fetched update over the installed theme (validated first). */
export const applyUpdate = async (
  backend: InstallBackend,
  theme: InstalledTheme,
  fetched: UpdateFetch,
): Promise<void> => {
  if (!fetched.json) {
    return;
  }
  validateCandidate(fetched.json, theme.name);
  await backend.write({
    name: theme.name,
    json: fetched.json,
    source: {
      ...theme.source,
      sha256: fetched.sha256,
      commit: fetched.commit ?? theme.source.commit,
    },
    replace: true,
  });
};
