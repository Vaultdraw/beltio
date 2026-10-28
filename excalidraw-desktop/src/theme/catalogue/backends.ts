/** Catalogue backends: the desktop app (Rust fetches and caches) and the browser harness. */

import { isTauriAvailable } from "../../vault/DesktopVaultRepository";
import { LOOPBACK, readCapped, sha256Hex } from "../install/backends";
import { InstallError, toInstallError } from "../install/types";

import type { CatalogueBackend, RawIndex } from "./types";

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export const tauriCatalogueBackend = (
  invoke: Invoke,
  commands: { cached: string; refresh: string; preview?: string } = {
    cached: "theme_catalogue_cached",
    refresh: "theme_catalogue_index",
    preview: "theme_catalogue_preview",
  },
): CatalogueBackend => {
  const call = async <T>(cmd: string, args: Record<string, unknown>) => {
    try {
      return await invoke<T>(cmd, args);
    } catch (err) {
      throw toInstallError(err);
    }
  };
  return {
    cached: () => call<RawIndex | null>(commands.cached, {}),
    refresh: (url, maxBytes) =>
      call<RawIndex>(commands.refresh, { url, maxBytes }),
    preview: async (url, maxBytes) => {
      if (!commands.preview) {
        throw new InstallError("NO_PREVIEW", "This list has no previews");
      }
      return new Uint8Array(
        await call<ArrayBuffer>(commands.preview, { url, maxBytes }),
      );
    },
  };
};

const CACHE_KEY = "vaultdraw-theme-catalogue-v1";
export const PLUGIN_CACHE_KEY = "vaultdraw-plugin-registry-v1";

/** https, or http on this machine (the browser harness). */
const webUrl = (raw: string, win: Window): URL => {
  let url: URL;
  try {
    url = new URL(raw, win.location.href);
  } catch {
    throw new InstallError("BAD_URL", `"${raw}" is not a web address`);
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && LOOPBACK.has(url.hostname))
  ) {
    throw new InstallError("BAD_URL", "Only https addresses can be used");
  }
  return url;
};

const download = async (
  raw: string,
  maxBytes: number,
  win: Window,
): Promise<Uint8Array<ArrayBuffer>> => {
  const url = webUrl(raw, win);
  let response: Response;
  try {
    response = await win.fetch(url.href);
  } catch {
    throw new InstallError("NETWORK", `Could not reach ${url.host}`);
  }
  if (!response.ok) {
    throw new InstallError(
      "HTTP_STATUS",
      `${url.host} answered ${response.status}`,
    );
  }
  return readCapped(response, maxBytes);
};

/** Browser harness: plain fetch, the list cached in localStorage. */
export const browserCatalogueBackend = (
  win: Window,
  cacheKey = CACHE_KEY,
  invalidMessage = "The themes list is not valid JSON",
): CatalogueBackend => ({
  cached: async () => {
    try {
      const raw = win.localStorage.getItem(cacheKey);
      return raw ? (JSON.parse(raw) as RawIndex) : null;
    } catch {
      return null;
    }
  },
  refresh: async (url, maxBytes) => {
    const bytes = await download(url, maxBytes, win);
    let json: string;
    try {
      json = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .replace(/^﻿/, "");
      JSON.parse(json);
    } catch {
      throw new InstallError("INVALID_INDEX", invalidMessage);
    }
    const raw: RawIndex = {
      json,
      sha256: await sha256Hex(bytes),
      fetched_at: Math.floor(Date.now() / 1000),
      url,
    };
    try {
      win.localStorage.setItem(cacheKey, JSON.stringify(raw));
    } catch {
      // Storage full or blocked: the list still shows this time.
    }
    return raw;
  },
  preview: (url, maxBytes) => download(url, maxBytes, win),
});

/** The backend for this window. */
export const getCatalogueBackend = async (
  win: Window,
): Promise<CatalogueBackend> => {
  if (isTauriAvailable(win)) {
    const { invoke } = await import("@tauri-apps/api/core");
    return tauriCatalogueBackend(invoke as Invoke);
  }
  return browserCatalogueBackend(win);
};
