/**
 * The quiet safety checks for the two webview download paths (theme install and the lists
 * catalogue). Only the browser harness uses them: in the desktop app Rust does every download
 * (`src-tauri/src/network.rs`). The same rules apply here: Offline mode and the per-purpose switch
 * stop the request first, https only, no private or local addresses, and a redirect is vetted like
 * the first address. The one exception is plain http to this machine, which the harness needs.
 */

import { isTauriAvailable } from "../vault/DesktopVaultRepository";
import { InstallError } from "../theme/install/types";

import { webFetchBlockReason, type WebFetchField } from "./webFetchPolicy";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const v4 = (host: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return m ? m.slice(1).map(Number) : null;
};

/** True for a host name or IP literal that points into this machine or a private network. */
export const isLocalOrPrivateHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home.arpa") ||
    (!host.includes(".") && !host.startsWith("["))
  ) {
    return true;
  }
  const o = v4(host);
  if (o) {
    const [a, b] = o;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && o[2] === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (host.startsWith("[")) {
    const h = host.slice(1, -1);
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (mapped) {
      return isLocalOrPrivateHost(mapped[1]);
    }
    return (
      h === "::" ||
      h === "::1" ||
      /^f[cd]/.test(h) ||
      /^fe[89ab]/.test(h) ||
      /^::ffff:/.test(h)
    );
  }
  return false;
};

/**
 * The address to fetch, or an InstallError. Refuses: the desktop app (it must use Rust),
 * Offline mode or the purpose switched off, anything but https (http only to loopback),
 * user info, and private or local addresses.
 */
export const vetWebUrl = (
  raw: string,
  win: Window,
  field: WebFetchField,
): URL => {
  if (isTauriAvailable(win)) {
    throw new InstallError(
      "BAD_URL",
      "Downloads go through the desktop app, not the page",
    );
  }
  const reason = webFetchBlockReason(field, win);
  if (reason) {
    throw new InstallError("NETWORK_DISABLED", reason);
  }
  let url: URL;
  try {
    url = new URL(raw, win.location.href);
  } catch {
    throw new InstallError("BAD_URL", `"${raw}" is not a web address`);
  }
  if (url.username || url.password) {
    throw new InstallError(
      "BAD_URL",
      "Addresses with a password are not allowed",
    );
  }
  const loopbackHttp =
    url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !loopbackHttp) {
    throw new InstallError("BAD_URL", "Only https addresses can be used");
  }
  if (!loopbackHttp && isLocalOrPrivateHost(url.hostname)) {
    throw new InstallError(
      "BAD_URL",
      "Addresses on this computer or a private network are not allowed",
    );
  }
  return url;
};

/** Fetches `raw` after `vetWebUrl`; a redirect to an address that would be refused is refused. */
export const guardedFetch = async (
  raw: string,
  win: Window,
  field: WebFetchField,
): Promise<{ response: Response; url: URL }> => {
  const url = vetWebUrl(raw, win, field);
  let response: Response;
  try {
    response = await win.fetch(url.href);
  } catch {
    throw new InstallError("NETWORK", `Could not reach ${url.host}`);
  }
  if (response.redirected && response.url) {
    try {
      vetWebUrl(response.url, win, field);
    } catch (err) {
      void response.body?.cancel().catch(() => {});
      throw err;
    }
  }
  if (!response.ok) {
    throw new InstallError(
      "HTTP_STATUS",
      `${url.host} answered ${response.status}`,
    );
  }
  return { response, url };
};
