import { afterEach, describe, expect, it, vi } from "vitest";

import { browserBackend, tauriBackend } from "../theme/install/backends";
import {
  applyUpdate,
  checkUpdates,
  freeName,
  installCandidate,
  kibToBytes,
  validateCandidate,
} from "../theme/install/installer";
import { InstallError, toInstallError } from "../theme/install/types";
import {
  getThemeRegistry,
  loadThemeRegistry,
  setThemeRegistry,
} from "../theme/registry";
import {
  DEFAULT_PREFERENCES,
  normalizePreferences,
} from "../vault/preferences";
import {
  configToPreferences,
  preferencesToConfigChanges,
} from "../vault/settingsSync";

import type {
  InstallBackend,
  InstalledTheme,
  WriteRequest,
} from "../theme/install/types";

const THEME = JSON.stringify({
  name: "Midnight",
  author: "Ada",
  dark: { mSurface: "#101820", mOnSurface: "#e8e8e8", mPrimary: "#4aa3ff" },
});

const fakeBackend = (over: Partial<InstallBackend> = {}) => {
  const written: WriteRequest[] = [];
  const backend: InstallBackend = {
    resolve: vi.fn(),
    fetch: vi.fn(),
    write: async (r) => {
      written.push(r);
      return { name: r.name };
    },
    installed: async () => [],
    updateFetch: vi.fn(),
    uninstall: vi.fn(),
    ...over,
  };
  return { backend, written };
};

afterEach(() => {
  setThemeRegistry(null);
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("validateCandidate", () => {
  it("returns the theme's own name, or the fallback", () => {
    expect(validateCandidate(THEME, "file")).toBe("Midnight");
    const unnamed = JSON.stringify({ dark: JSON.parse(THEME).dark });
    expect(validateCandidate(unnamed, "My-File")).toBe("My-File");
  });

  it("rejects non-JSON and non-theme files with a message", () => {
    expect(() => validateCandidate("<html>", "x")).toThrow(/not valid JSON/);
    expect(() => validateCandidate("[]", "x")).toThrow(InstallError);
    expect(() => validateCandidate('{"dark":{"mSurface":"red"}}', "x")).toThrow(
      InstallError,
    );
  });
});

describe("installCandidate", () => {
  const source = { url: "http://localhost/m.json", sha256: "abc" };

  it("validates, then writes under the theme's name", async () => {
    const { backend, written } = fakeBackend();
    const name = await installCandidate(backend, {
      json: THEME,
      source,
      fallbackName: "m",
    });
    expect(name).toBe("Midnight");
    expect(written).toEqual([
      { name: "Midnight", json: THEME, source, replace: false },
    ]);
  });

  it("never writes an invalid theme", async () => {
    const { backend, written } = fakeBackend();
    await expect(
      installCandidate(backend, { json: "{}", source, fallbackName: "m" }),
    ).rejects.toBeInstanceOf(InstallError);
    expect(written).toEqual([]);
  });

  it("installs under another name or replaces on request", async () => {
    const { backend, written } = fakeBackend();
    const cand = { json: THEME, source, fallbackName: "m" };
    await installCandidate(backend, cand, { asName: "Midnight 2" });
    await installCandidate(backend, cand, { replace: true });
    expect(written.map((w) => [w.name, w.replace])).toEqual([
      ["Midnight 2", false],
      ["Midnight", true],
    ]);
  });
});

describe("names and limits", () => {
  it("freeName finds the first unused suffix, ignoring case", () => {
    expect(freeName("Nord", ["Nord", "nord 2"])).toBe("Nord 3");
    expect(freeName("Nord", [])).toBe("Nord 2");
  });

  it("clamps the size limit to 1..256 KiB", () => {
    expect(kibToBytes(64)).toBe(65536);
    expect(kibToBytes(0)).toBe(1024);
    expect(kibToBytes(9999)).toBe(256 * 1024);
  });
});

describe("updates", () => {
  const theme: InstalledTheme = {
    name: "Midnight",
    source: { url: "http://localhost/m.json", sha256: "old" },
  };

  it("reports current, newer and failed themes without writing", async () => {
    const { backend, written } = fakeBackend({
      updateFetch: async (name) => {
        if (name === "A") {
          return { changed: false, sha256: "s" };
        }
        if (name === "B") {
          return { changed: true, json: THEME, sha256: "new" };
        }
        throw new InstallError("NETWORK", "offline");
      },
    });
    const out = await checkUpdates(
      backend,
      [{ name: "A" }, { name: "B" }, { name: "C" }].map((t) => ({
        ...t,
        source: theme.source,
      })),
      1024,
    );
    expect(out.map((o) => o.state)).toEqual(["current", "newer", "failed"]);
    expect(written).toEqual([]);
  });

  it("applyUpdate validates and replaces, keeping the source and the new hash", async () => {
    const { backend, written } = fakeBackend();
    await applyUpdate(backend, theme, {
      changed: true,
      json: THEME,
      sha256: "new",
    });
    expect(written[0]).toMatchObject({
      name: "Midnight",
      replace: true,
      source: { url: "http://localhost/m.json", sha256: "new" },
    });
    await expect(
      applyUpdate(backend, theme, { changed: true, json: "{}", sha256: "x" }),
    ).rejects.toBeInstanceOf(InstallError);
    expect(written).toHaveLength(1);
  });
});

describe("tauriBackend", () => {
  it("maps calls to the commands and turns rejections into InstallError", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "theme_installed") {
        return [];
      }
      throw Object.assign(new Error("not allowed"), {
        code: "NETWORK_NOT_ALLOWED",
      });
    });
    const b = tauriBackend(invoke as never);
    expect(await b.installed()).toEqual([]);
    await expect(b.resolve("x", 10)).rejects.toMatchObject({
      code: "NETWORK_NOT_ALLOWED",
      message: "not allowed",
    });
    expect(toInstallError("boom").code).toBe("ERROR");
  });
});

describe("browserBackend", () => {
  const stubFetch = (body: string, status = 200) =>
    vi.fn(async () => new Response(body, { status }));

  it("downloads a file from a loopback address, installs it and lists it in the registry", async () => {
    const fetchMock = stubFetch(THEME);
    const win = {
      location: window.location,
      fetch: fetchMock,
      localStorage,
    } as unknown as Window;
    const b = browserBackend(win);
    const resolved = await b.resolve("http://127.0.0.1:9/Midnight.json", 65536);
    expect(resolved).toMatchObject({ kind: "file", name: "Midnight" });
    if (resolved.kind !== "file") {
      throw new Error("file expected");
    }
    expect(resolved.sha256).toMatch(/^[0-9a-f]{64}$/);

    await b.write({
      name: "Midnight",
      json: resolved.json,
      source: { url: resolved.url, sha256: resolved.sha256 },
      replace: false,
    });
    await expect(
      b.write({
        name: "midnight",
        json: THEME,
        source: { sha256: "x" },
        replace: false,
      }),
    ).rejects.toMatchObject({ code: "THEME_EXISTS" });

    const registry = await loadThemeRegistry(window, { tauri: false });
    expect(registry.themes.map((t) => t.key)).toContain("Midnight");
    expect(getThemeRegistry().mode).toBe("browser");

    expect(await b.updateFetch("Midnight", 65536)).toMatchObject({
      changed: false,
    });
    await b.uninstall("Midnight");
    expect(await b.installed()).toEqual([]);
  });

  it("refuses plain http for other hosts, big files, bad status and repo inputs", async () => {
    const win = (f: typeof fetch) =>
      ({
        location: window.location,
        fetch: f,
        localStorage,
      } as unknown as Window);
    await expect(
      browserBackend(win(stubFetch(THEME))).resolve(
        "http://example.com/a.json",
        1000,
      ),
    ).rejects.toMatchObject({ code: "BAD_URL" });
    await expect(
      browserBackend(win(stubFetch(THEME))).resolve(
        "https://example.com/a.json",
        10,
      ),
    ).rejects.toMatchObject({ code: "TOO_LARGE" });
    await expect(
      browserBackend(win(stubFetch("", 404))).resolve(
        "https://example.com/a.json",
        1000,
      ),
    ).rejects.toMatchObject({ code: "HTTP_STATUS" });
    await expect(
      browserBackend(win(stubFetch(THEME))).fetch(
        { kind: "repo", owner: "o", repo: "r", commit: "main", path: "a.json" },
        1000,
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
});

describe("network and install keys", () => {
  it("defaults: network on, themes not yet allowed, 64 KiB", () => {
    expect(DEFAULT_PREFERENCES.networkEnabled).toBe(true);
    expect(DEFAULT_PREFERENCES.networkAllowThemes).toBeUndefined();
    expect(DEFAULT_PREFERENCES.themeInstallMaxKb).toBe(64);
  });

  it("reads config.toml values and flags invalid ones", () => {
    const ok = configToPreferences({
      network: { enabled: false, allow_themes: true },
      themes: { max_install_kb: 128 },
    });
    expect(ok.values).toMatchObject({
      networkEnabled: false,
      networkAllowThemes: true,
      themeInstallMaxKb: 128,
    });
    const bad = configToPreferences({
      network: { allow_themes: "yes" },
      themes: { max_install_kb: 999 },
    });
    expect(bad.values.networkAllowThemes).toBeUndefined();
    expect(bad.values.themeInstallMaxKb).toBe(64);
    expect(bad.problems.map((p) => p.key).sort()).toEqual([
      "network.allow_themes",
      "themes.max_install_kb",
    ]);
  });

  it("writes consent and removes the key when it goes back to 'ask'", () => {
    const base = normalizePreferences({});
    const allowed = { ...base, networkAllowThemes: true };
    expect(preferencesToConfigChanges(base, allowed)).toEqual([
      { key: "network.allow_themes", value: true },
    ]);
    expect(preferencesToConfigChanges(allowed, base)).toEqual([
      { key: "network.allow_themes", value: null },
    ]);
  });
});
