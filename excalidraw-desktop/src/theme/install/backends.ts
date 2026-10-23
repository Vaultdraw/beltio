/** Install backends: the desktop app (Rust does the network) and the browser harness. */

import { isTauriAvailable } from "../../vault/DesktopVaultRepository";

import { readStoredThemes, writeStoredThemes } from "./browserStore";
import { InstallError, toInstallError } from "./types";

import type {
  FetchRef,
  Fetched,
  InstallBackend,
  InstalledTheme,
  Resolved,
  UpdateFetch,
  WriteRequest,
} from "./types";

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export const tauriBackend = (invoke: Invoke): InstallBackend => {
  const call = async <T>(cmd: string, args: Record<string, unknown>) => {
    try {
      return await invoke<T>(cmd, args);
    } catch (err) {
      throw toInstallError(err);
    }
  };
  return {
    resolve: (input, maxBytes) =>
      call<Resolved>("theme_resolve", { input, maxBytes }),
    fetch: (ref, maxBytes) =>
      call<Fetched>("theme_fetch", { fetchRef: ref, maxBytes }),
    write: (request) => call<{ name: string }>("theme_write", { req: request }),
    installed: () => call<InstalledTheme[]>("theme_installed", {}),
    updateFetch: (name, maxBytes) =>
      call<UpdateFetch>("theme_update_fetch", { name, maxBytes }),
    uninstall: async (name) => {
      await call("theme_uninstall", { name });
    },
  };
};

export const sha256Hex = async (
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

export const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

const tooLarge = (maxBytes: number) =>
  new InstallError(
    "TOO_LARGE",
    `The file is larger than ${Math.round(maxBytes / 1024)} KiB`,
  );

/** The body's bytes, stopping the download as soon as it passes `maxBytes`. */
export const readCapped = async (
  response: Response,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> => {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw tooLarge(maxBytes);
  }
  if (!response.body) {
    const all = new Uint8Array(await response.arrayBuffer());
    if (all.length > maxBytes) {
      throw tooLarge(maxBytes);
    }
    return all;
  }
  const reader = response.body.getReader();
  const out = new Uint8Array(maxBytes);
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return out.slice(0, length);
    }
    if (length + value.length > maxBytes) {
      void reader.cancel().catch(() => {});
      throw tooLarge(maxBytes);
    }
    out.set(value, length);
    length += value.length;
  }
};

/** Direct URL download only; https, or http on this machine. Themes are stored in localStorage. */
export const browserBackend = (win: Window): InstallBackend => {
  const download = async (raw: string, maxBytes: number): Promise<Fetched> => {
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
    const bytes = await readCapped(response, maxBytes);
    let json: string;
    try {
      json = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
        .decode(bytes)
        .replace(/^\uFEFF/, "");
    } catch {
      throw new InstallError("INVALID_FILE", "The file is not valid UTF-8");
    }
    return { json, sha256: await sha256Hex(bytes), url: url.href };
  };
  const stem = (url: string) =>
    decodeURIComponent(url.split("?")[0].split("/").pop() ?? "").replace(
      /\.json$/i,
      "",
    );
  return {
    resolve: async (input, maxBytes) => {
      const got = await download(input.trim(), maxBytes);
      return { kind: "file", name: stem(got.url), ...got };
    },
    fetch: async (ref: FetchRef, maxBytes) => {
      if (ref.kind !== "url") {
        throw new InstallError(
          "UNSUPPORTED",
          "Installing from a GitHub repo needs the desktop app",
        );
      }
      return download(ref.url, maxBytes);
    },
    write: async ({ name, json, source, replace }: WriteRequest) => {
      const all = readStoredThemes(win);
      const clash = all.find(
        (t) => t.name.toLowerCase() === name.toLowerCase(),
      );
      if (clash && !replace) {
        throw new InstallError(
          "THEME_EXISTS",
          `A theme named "${name}" is already installed`,
        );
      }
      writeStoredThemes(
        [
          ...all.filter((t) => t !== clash),
          {
            name,
            json,
            source: { ...source, installed: new Date().toISOString() },
          },
        ],
        win,
      );
      return { name };
    },
    installed: async () =>
      readStoredThemes(win).map(({ name, source }) => ({ name, source })),
    updateFetch: async (name, maxBytes) => {
      const found = readStoredThemes(win).find((t) => t.name === name);
      if (!found?.source.url) {
        throw new InstallError(
          "NOT_FOUND",
          `"${name}" has no web address to update from`,
        );
      }
      const got = await download(found.source.url, maxBytes);
      return got.sha256 === found.source.sha256
        ? { changed: false, sha256: got.sha256 }
        : { changed: true, json: got.json, sha256: got.sha256 };
    },
    uninstall: async (name) => {
      writeStoredThemes(
        readStoredThemes(win).filter((t) => t.name !== name),
        win,
      );
    },
  };
};

/** The backend for this window: Rust in the desktop app, plain fetch in the browser harness. */
export const getInstallBackend = async (
  win: Window,
): Promise<InstallBackend> => {
  if (isTauriAvailable(win)) {
    const { invoke } = await import("@tauri-apps/api/core");
    return tauriBackend(invoke as Invoke);
  }
  return browserBackend(win);
};
