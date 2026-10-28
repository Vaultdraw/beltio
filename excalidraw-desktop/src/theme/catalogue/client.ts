/** Loads the catalogue (cache first, one fetch when stale) and installs an entry through the install API. */

import { installCandidate, validateCandidate } from "../install/installer";
import { InstallError, toInstallError } from "../install/types";

import { parseIndex } from "./parseIndex";

import type { InstallBackend, InstalledTheme } from "../install/types";
import type {
  Catalogue,
  CatalogueBackend,
  CatalogueEntry,
  EntryStatus,
  LoadedCatalogue,
  RawIndex,
} from "./types";

export const MAX_INDEX_BYTES = 2 * 1024 * 1024;
export const MAX_PREVIEW_BYTES = 512 * 1024;

const toCatalogue = <E>(
  raw: RawIndex,
  parse: (json: string) => E[],
): Catalogue<E> => ({
  entries: parse(raw.json),
  sha256: raw.sha256,
  fetchedAt: raw.fetched_at,
  url: raw.url,
});

/** The cached list for `url`, or null (missing, for another address, or unreadable). */
const readCache = async <E>(
  backend: CatalogueBackend,
  url: string,
  parse: (json: string) => E[],
): Promise<Catalogue<E> | null> => {
  try {
    const raw = await backend.cached();
    return raw && raw.url === url ? toCatalogue(raw, parse) : null;
  } catch {
    return null;
  }
};

export interface LoadOptions {
  url: string;
  ttlHours: number;
  /** Fetch even when the cache is fresh. */
  force?: boolean;
  /** Unix seconds; injectable for tests. */
  now?: number;
}

/**
 * The list for the browser. A fresh cache costs no request. When the fetch fails, a cached list
 * is shown with the reason; with no cache the error is thrown.
 */
export const loadCatalogue = (
  backend: CatalogueBackend,
  options: LoadOptions,
): Promise<LoadedCatalogue> => loadIndex(backend, parseIndex, options);

/** The same for any index: the plugins registry passes its own parser. */
export const loadIndex = async <E>(
  backend: CatalogueBackend,
  parse: (json: string) => E[],
  {
    url,
    ttlHours,
    force = false,
    now = Math.floor(Date.now() / 1000),
  }: LoadOptions,
): Promise<LoadedCatalogue<E>> => {
  const cached = await readCache(backend, url, parse);
  if (cached && !force && ttlHours > 0) {
    const ageSeconds = now - cached.fetchedAt;
    if (ageSeconds >= 0 && ageSeconds < ttlHours * 3600) {
      return { catalogue: cached, stale: false };
    }
  }
  try {
    return {
      catalogue: toCatalogue(
        await backend.refresh(url, MAX_INDEX_BYTES),
        parse,
      ),
      stale: false,
    };
  } catch (err) {
    const error = toInstallError(err);
    const keepsCache =
      error.code !== "INVALID_INDEX" &&
      error.code !== "NETWORK_NOT_ALLOWED" &&
      error.code !== "NETWORK_DISABLED";
    if (cached && keepsCache) {
      return { catalogue: cached, stale: true, notice: error.message };
    }
    throw error;
  }
};

/** Address of a file in the themes repo: the index address with its file name swapped for `path`. */
export const entryUrl = (indexUrl: string, path: string): string =>
  new URL(path.split("/").map(encodeURIComponent).join("/"), indexUrl).href;

/** Whether an entry is installed, and whether the list has a newer file than the installed one. */
export const entryStatus = (
  entry: CatalogueEntry,
  installed: readonly InstalledTheme[],
): EntryStatus => {
  const found = installed.find(
    (t) => t.name.toLowerCase() === entry.name.toLowerCase(),
  );
  if (!found) {
    return "available";
  }
  // No hash (installed some other way): never offer to overwrite it.
  return !found.source.sha256 || found.source.sha256 === entry.sha256
    ? "installed"
    : "update";
};

/**
 * Downloads an entry's theme file, checks it against the list's hash, and installs it. `replace`
 * is for updates. Throws InstallError (HASH_MISMATCH when the file changed after the list was made).
 */
export const installEntry = async (
  backend: InstallBackend,
  entry: CatalogueEntry,
  indexUrl: string,
  maxBytes: number,
  options: { replace?: boolean } = {},
): Promise<string> => {
  const got = await backend.fetch(
    { kind: "url", url: entryUrl(indexUrl, entry.path) },
    maxBytes,
  );
  if (got.sha256 !== entry.sha256) {
    throw new InstallError(
      "HASH_MISMATCH",
      `${entry.name} changed after the list was made. Refresh the list and try again.`,
    );
  }
  const fileName = validateCandidate(got.json, entry.name);
  return installCandidate(
    backend,
    {
      json: got.json,
      fallbackName: entry.name,
      source: { url: got.url, sha256: got.sha256 },
    },
    {
      replace: options.replace ?? false,
      // The list's name wins, so the card finds the theme it installed.
      asName: fileName === entry.name ? undefined : entry.name,
    },
  );
};

/** Runs at most `limit` async jobs at a time (preview downloads). */
export const createLimiter = (limit: number) => {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(job: () => Promise<T>): Promise<T> => {
    if (running >= limit) {
      // The finishing job hands its slot over, so `running` never dips.
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      running++;
    }
    try {
      return await job();
    } finally {
      const wake = waiting.shift();
      if (wake) {
        wake();
      } else {
        running--;
      }
    }
  };
};

/** MIME type of a PNG, JPEG or WebP by its first bytes (the Blob needs one). */
export const imageMime = (bytes: Uint8Array): string => {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }
  return "image/webp";
};
