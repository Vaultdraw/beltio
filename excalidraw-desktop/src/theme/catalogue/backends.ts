/** Catalogue backends: the desktop app (Rust fetches and caches) and the browser harness. */

import { isTauriAvailable } from "../../vault/DesktopVaultRepository";
import { guardedFetch } from "../../network/webFetchGuard";
import { readCapped, sha256Hex } from "../install/backends";
import { InstallError, toInstallError } from "../install/types";

import type { WebFetchField } from "../../network/webFetchPolicy";
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

const download = async (
  raw: string,
  maxBytes: number,
  win: Window,
  field: WebFetchField,
): Promise<Uint8Array<ArrayBuffer>> => {
  const { response } = await guardedFetch(raw, win, field);
  return readCapped(response, maxBytes);
};

/** Browser harness: plain fetch, the list cached in localStorage. */
export const browserCatalogueBackend = (
  win: Window,
  cacheKey = CACHE_KEY,
  invalidMessage = "The themes list is not valid JSON",
  field: WebFetchField = "networkAllowThemes",
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
    const bytes = await download(url, maxBytes, win, field);
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
  preview: (url, maxBytes) => download(url, maxBytes, win, field),
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
