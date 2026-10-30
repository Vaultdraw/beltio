/**
 * The webview download paths (theme install, theme and plugin lists) keep the same quiet safety
 * checks as the Rust downloader: Offline mode, https only, no private or local address, redirects
 * vetted, size cap. In the desktop app they are never reached (the window has the Tauri bridge).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isLocalOrPrivateHost } from "../network/webFetchGuard";
import { browserCatalogueBackend } from "../theme/catalogue/backends";
import { browserBackend } from "../theme/install/backends";
import { updatePreferences } from "../vault/preferences";

const RESET = {
  networkOffline: false,
  networkEnabled: true,
  networkAllowThemes: undefined,
  networkAllowPlugins: undefined,
};
beforeEach(() => updatePreferences(RESET));
afterEach(() => updatePreferences(RESET));

const mkWin = (f: typeof fetch, extra: object = {}) =>
  ({ location: window.location, fetch: f, localStorage, ...extra }) as unknown as Window;

const OK = () => vi.fn(async () => new Response('{"a":1}'));

const REFUSED = [
  "http://example.com/a.json",
  "ftp://example.com/a.json",
  "file:///etc/passwd",
  "https://user:pw@example.com/a.json",
  "https://localhost/a.json",
  "https://printer.local/a.json",
  "https://intranet/a.json",
  "https://127.0.0.1/a.json",
  "https://10.0.0.5/a.json",
  "https://172.16.0.1/a.json",
  "https://192.168.1.1/a.json",
  "https://169.254.169.254/latest",
  "https://100.64.0.1/a.json",
  "https://0.0.0.0/a.json",
  "https://[::1]/a.json",
  "https://[fd00::1]/a.json",
  "https://[fe80::1]/a.json",
  "https://[::ffff:10.0.0.1]/a.json",
];

describe("webview downloads: safety checks", () => {
  it.each(REFUSED)("install backend refuses %s before any request", async (u) => {
    const f = OK();
    await expect(browserBackend(mkWin(f)).resolve(u, 65536)).rejects.toMatchObject({
      code: "BAD_URL",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it.each(REFUSED)("catalogue backend refuses %s before any request", async (u) => {
    const f = OK();
    await expect(
      browserCatalogueBackend(mkWin(f)).refresh(u, 65536),
    ).rejects.toMatchObject({ code: "BAD_URL" });
    expect(f).not.toHaveBeenCalled();
  });

  it("allows https to a public host and http to loopback (the harness)", async () => {
    const f = OK();
    const b = browserCatalogueBackend(mkWin(f));
    await b.refresh("https://raw.githubusercontent.com/x/index.json", 65536);
    await b.refresh("http://127.0.0.1:9/index.json", 65536);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["networkOffline", true],
    ["networkEnabled", false],
  ])("Offline mode (%s=%s) stops every webview download before a request", async (k, v) => {
    updatePreferences({ [k]: v });
    const f = OK();
    const win = mkWin(f);
    await expect(
      browserBackend(win).fetch({ kind: "url", url: "https://example.com/a.json" }, 65536),
    ).rejects.toMatchObject({ code: "NETWORK_DISABLED" });
    await expect(
      browserCatalogueBackend(win).refresh("https://example.com/i.json", 65536),
    ).rejects.toMatchObject({ code: "NETWORK_DISABLED" });
    await expect(
      browserCatalogueBackend(win).preview("https://example.com/p.png", 65536),
    ).rejects.toMatchObject({ code: "NETWORK_DISABLED" });
    expect(f).not.toHaveBeenCalled();
  });

  it("the plugins list follows its own switch, themes follow theirs", async () => {
    updatePreferences({ networkAllowPlugins: false });
    const f = OK();
    const win = mkWin(f);
    await expect(
      browserCatalogueBackend(win, "k", "bad", "networkAllowPlugins").refresh(
        "https://example.com/i.json",
        65536,
      ),
    ).rejects.toMatchObject({ code: "NETWORK_DISABLED" });
    await browserCatalogueBackend(win).refresh("https://example.com/i.json", 65536);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("the desktop window (Tauri bridge) never uses the webview fetch", async () => {
    const f = OK();
    const win = mkWin(f, { __TAURI_INTERNALS__: { invoke: () => {} } });
    await expect(
      browserBackend(win).fetch({ kind: "url", url: "https://example.com/a.json" }, 65536),
    ).rejects.toMatchObject({ code: "BAD_URL" });
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses a redirect that lands on a private address", async () => {
    const res = new Response("x");
    Object.defineProperty(res, "redirected", { value: true });
    Object.defineProperty(res, "url", { value: "https://192.168.0.1/a.json" });
    await expect(
      browserBackend(mkWin(vi.fn(async () => res))).fetch(
        { kind: "url", url: "https://example.com/a.json" },
        65536,
      ),
    ).rejects.toMatchObject({ code: "BAD_URL" });
  });

  it("stops a download that passes the size cap", async () => {
    const f = vi.fn(async () => new Response(new Uint8Array(100)));
    await expect(
      browserBackend(mkWin(f)).fetch({ kind: "url", url: "https://example.com/a.json" }, 10),
    ).rejects.toBeTruthy();
  });

  it("public names and addresses pass the host check", () => {
    for (const h of ["example.com", "93.184.216.34", "172.32.0.1", "[2606:4700::1]"]) {
      expect(isLocalOrPrivateHost(h)).toBe(false);
    }
  });
});
