import { afterEach, describe, expect, it, vi } from "vitest";

import { loadBuiltinThemes } from "../theme";
import {
  buildThemeRegistry,
  builtinRegistry,
  findTheme,
  getThemeRegistry,
  loadThemeRegistry,
  resolveSelectedTheme,
  setThemeRegistry,
  THEMES_CHANGED_EVENT,
  watchThemeRegistry,
  type ThemeListingEntry,
} from "../theme/registry";

const DIR = "/home/u/.config/vaultdraw/themes";

const palette = (surface: string, text: string, primary: string) =>
  JSON.stringify({
    dark: { mSurface: surface, mOnSurface: text, mPrimary: primary },
  });

const file = (
  id: string,
  json: string | null,
  opts: { folder?: boolean; error?: string } = {},
): ThemeListingEntry => ({
  id,
  path: opts.folder ? `${DIR}/${id}/${id}.json` : `${DIR}/${id}.json`,
  json,
  error: opts.error ?? null,
});

afterEach(() => setThemeRegistry(null));

describe("theme registry rules", () => {
  it("browser mode has exactly the built-ins, Default first", async () => {
    const reg = builtinRegistry();
    expect(reg.themes.map((t) => t.key)).toEqual(
      (await loadBuiltinThemes()).map((t) => t.name),
    );
    expect(reg.themes[0].key).toBe("Default");
    expect(reg.themes.every((t) => t.source === "builtin")).toBe(true);
  });

  it("finds themes by key, name or slug, case-insensitively", () => {
    const reg = buildThemeRegistry([
      file(
        "my-theme",
        JSON.stringify({
          name: "Ocean Breeze",
          ...JSON.parse(palette("#001122", "#eeeeee", "#33aaff")),
        }),
      ),
    ]);
    // Noctalia names it "Tokyo-Night"; the old "Tokyo Night" still matches by slug.
    expect(findTheme(reg, "tokyo night")?.key).toBe("Tokyo-Night");
    expect(findTheme(reg, "TOKYO-NIGHT")?.key).toBe("Tokyo-Night");
    expect(findTheme(reg, "Rose Pine")?.key).toBe("Rosé Pine");
    expect(findTheme(reg, "My-Theme")?.key).toBe("my-theme");
    expect(findTheme(reg, "ocean breeze")?.key).toBe("my-theme");
    expect(findTheme(reg, "nope")).toBeNull();
  });

  it("a user theme overrides the built-in with the same name, in place", () => {
    const builtins = builtinRegistry().themes.length;
    const index = builtinRegistry().themes.findIndex((t) => t.id === "dracula");
    expect(index).toBeGreaterThan(0);
    const reg = buildThemeRegistry([
      file("dracula", palette("#101010", "#fafafa", "#ff00ff")),
    ]);
    expect(reg.themes).toHaveLength(builtins);
    const entry = findTheme(reg, "Dracula")!;
    expect(entry.source).toBe("user");
    expect(entry.overridesBuiltin).toBe(true);
    expect(entry.theme.dark.mSurface).toBe("#101010");
    expect(reg.themes.indexOf(entry)).toBe(index);
  });

  it("new user themes are appended after the built-ins", () => {
    const reg = buildThemeRegistry([
      file("Zeta", palette("#000000", "#ffffff", "#ff0000")),
      file("Alpha", palette("#000000", "#ffffff", "#00ff00")),
    ]);
    expect(reg.themes.slice(-2).map((t) => t.key)).toEqual(["Alpha", "Zeta"]);
  });

  it("flat file and folder with the same id: the folder wins with a warning", () => {
    const reg = buildThemeRegistry([
      file("Mine", palette("#111111", "#eeeeee", "#ff0000")),
      file("mine", palette("#222222", "#eeeeee", "#00ff00"), { folder: true }),
    ]);
    const entry = findTheme(reg, "mine")!;
    expect(entry.theme.dark.mSurface).toBe("#222222");
    expect(entry.path).toBe(`${DIR}/mine/mine.json`);
    expect(reg.fileProblems).toHaveLength(1);
    expect(reg.fileProblems[0]).toMatchObject({ kind: "warning" });
    expect(reg.fileProblems[0].message).toMatch(/using the folder/);
    expect(
      reg.themes.filter((t) => t.key.toLowerCase() === "mine"),
    ).toHaveLength(1);
  });

  it("collects read errors, bad JSON and invalid palettes per file", () => {
    const reg = buildThemeRegistry([
      file("Unreadable", null, {
        error: "Unreadable.json is larger than 256 KiB",
      }),
      file("BadJson", "{ nope"),
      file("Invalid", JSON.stringify({ dark: { mSurface: "#000" } })),
      file("Good", palette("#000000", "#ffffff", "#ff8800")),
    ]);
    const byId = Object.fromEntries(reg.fileProblems.map((p) => [p.id, p]));
    expect(byId.Unreadable.message).toMatch(/256 KiB/);
    expect(byId.BadJson.message).toMatch(/not valid JSON/);
    expect(byId.Invalid.message).toMatch(/mOnSurface|mPrimary/);
    expect(Object.values(byId).every((p) => p.kind === "error")).toBe(true);
    expect(findTheme(reg, "Good")).not.toBeNull();
    expect(findTheme(reg, "Invalid")).toBeNull();
  });

  it("user theme warnings are kept for the card; built-ins carry none", () => {
    const reg = buildThemeRegistry([
      file(
        "Extra",
        JSON.stringify({
          wat: 1,
          ...JSON.parse(palette("#000000", "#ffffff", "#ff8800")),
        }),
      ),
    ]);
    expect(findTheme(reg, "Extra")!.warnings.join("\n")).toMatch(
      /wat: unknown key/,
    );
    expect(
      reg.themes
        .filter((t) => t.source === "builtin")
        .every((t) => t.warnings.length === 0),
    ).toBe(true);
  });

  it("unknown selected theme falls back to Default with a problem", () => {
    const sel = resolveSelectedTheme(builtinRegistry(), "Solarised Dark");
    expect(sel.entry.key).toBe("Default");
    expect(sel.problem).toMatch(/"Solarised Dark" was not found/);
    expect(
      resolveSelectedTheme(builtinRegistry(), "dracula").problem,
    ).toBeNull();
  });

  it("broken selected theme falls back to Default and says why", () => {
    const reg = buildThemeRegistry([file("Broken", "{")]);
    const sel = resolveSelectedTheme(reg, "broken");
    expect(sel.entry.key).toBe("Default");
    expect(sel.problem).toMatch(/could not be loaded.*not valid JSON/);
  });
});

describe("theme registry runtime", () => {
  it("browser: built-ins only, no invoke", async () => {
    const invoke = vi.fn();
    const reg = await loadThemeRegistry(window, { tauri: false, invoke });
    expect(invoke).not.toHaveBeenCalled();
    expect(reg.mode).toBe("browser");
    expect(getThemeRegistry()).toBe(reg);
  });

  it("tauri: parses list_themes and caches it", async () => {
    const invoke = vi.fn(async () => [
      file("Mine", palette("#000000", "#ffffff", "#ff8800")),
    ]);
    const reg = await loadThemeRegistry(window, {
      tauri: true,
      invoke: invoke as any,
    });
    expect(invoke).toHaveBeenCalledWith("list_themes");
    expect(reg.mode).toBe("tauri");
    expect(findTheme(getThemeRegistry(), "mine")?.source).toBe("user");
  });

  it("tauri: a failing list_themes keeps the built-ins and reports it", async () => {
    const invoke = vi.fn(async () => {
      throw Object.assign(new Error("permission denied"), { code: "IO" });
    });
    const reg = await loadThemeRegistry(window, {
      tauri: true,
      invoke: invoke as any,
    });
    expect(reg.themes.length).toBe(builtinRegistry().themes.length);
    expect(reg.loadError).toMatch(/permission denied/);
  });

  it("reloads on config-change inside themes/ and notifies the window", async () => {
    let listing: ThemeListingEntry[] = [];
    const invoke = vi.fn(async () => listing);
    let handler: ((e: { payload: unknown }) => void) | null = null;
    const unlisten = vi.fn();
    const listen = vi.fn(async (_event: string, h: any) => {
      handler = h;
      return unlisten;
    });
    const seen: unknown[] = [];
    const onChange = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(THEMES_CHANGED_EVENT, onChange);
    const stop = watchThemeRegistry(window, {
      tauri: true,
      invoke: invoke as any,
      listen: listen as any,
    });
    await vi.waitFor(() => expect(handler).not.toBeNull());
    expect(listen.mock.calls[0][0]).toBe("config-change");

    // config.toml edits do not rescan themes
    handler!({ payload: { paths: ["/home/u/.config/vaultdraw/config.toml"] } });
    await new Promise((r) => setTimeout(r, 10));
    expect(invoke).not.toHaveBeenCalled();

    listing = [file("Fresh", palette("#000000", "#ffffff", "#ff8800"))];
    handler!({ payload: { paths: [`${DIR}/Fresh.json`] } });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(findTheme(getThemeRegistry(), "fresh")).not.toBeNull();

    stop();
    window.removeEventListener(THEMES_CHANGED_EVENT, onChange);
    expect(unlisten).toHaveBeenCalled();
  });
});
