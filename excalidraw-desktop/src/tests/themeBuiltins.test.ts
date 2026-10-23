/**
 * Bundled themes: sources and clash rules, lazy parsing, cheap summaries,
 * and the startup cost of building the theme list.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EAGER_THEME_IDS,
  builtinThemeFiles,
  getBuiltinTheme,
  isBuiltinThemeLoaded,
  loadBuiltinTheme,
  loadBuiltinThemes,
  previewFromTheme,
} from "../theme";
import { buildBuiltinIndex } from "../theme/builtinIndex";
import { parsedBuiltinCount, resetBuiltinCaches } from "../theme/builtins";
import {
  builtinRegistry,
  isThemeReady,
  listThemeSummaries,
  loadSelectedTheme,
  loadThemeEntry,
  resolveSelectedTheme,
  resolveTheme,
  setThemeRegistry,
  THEMES_CHANGED_EVENT,
} from "../theme/registry";
import { computeAppearance } from "../vault/appearance";

afterEach(() => setThemeRegistry(null));

const NOCTALIA = [
  "ayu",
  "catppuccin",
  "dracula",
  "eldritch",
  "gruvbox",
  "kanagawa",
  "noctalia",
  "nord",
  "rose-pine",
  "tokyo-night",
];

describe("bundled theme sources", () => {
  const files = builtinThemeFiles();
  const origin = (id: string) => files.find((f) => f.id === id)?.origin;

  it("Noctalia's palettes replace ours; community replaces ours; Default stays", () => {
    for (const id of NOCTALIA) {
      expect(origin(id), id).toBe("noctalia");
      expect(files.find((f) => f.id === id)?.author).toMatch(
        /^Noctalia \(MIT\)/,
      );
    }
    // Community palettes with the same name as an older Vaultdraw built-in.
    expect(origin("everforest")).toBe("community");
    expect(origin("solarized")).toBe("community");
    expect(
      files.filter((f) => f.origin === "vaultdraw").map((f) => f.id),
    ).toEqual(["default"]);
    expect(files[0].id).toBe("default");
    // Cendre (MIT, its three depths) is the one non-Noctalia palette here.
    const community = files.filter((f) => f.origin === "community");
    expect(
      community
        .filter((f) => !f.id.startsWith("cendre"))
        .every((f) => f.author === "Noctalia community palettes"),
    ).toBe(true);
    expect(
      community.filter((f) => f.id.startsWith("cendre")).map((f) => f.name),
    ).toEqual(["Cendre", "Cendre Medium", "Cendre Soft"]);
    expect(files.length).toBe(123);
  });

  it("records which bundled palettes carry (harmless) warnings", async () => {
    const withWarnings = (await loadBuiltinThemes()).filter(
      (t) => t.warnings.length,
    );
    const noctalia = withWarnings
      .filter((t) => origin(t.id) === "noctalia")
      .map((t) => t.id);
    // Light variants whose on-primary text is below 3:1; tokens adjust it.
    expect(noctalia).toEqual(["ayu", "gruvbox", "rose-pine"]);
    for (const t of withWarnings) {
      for (const w of t.warnings) {
        expect(w, t.id).toMatch(/low contrast|is too (light|dark) for/);
      }
    }
    const community = withWarnings.filter((t) => origin(t.id) === "community");
    expect(community.length).toBe(37);
  });
});

describe("builtin-index.json", () => {
  const INDEX_PATH = resolve(__dirname, "../theme/builtin-index.json");

  it("matches the theme files (UPDATE_THEME_INDEX=1 rewrites it)", () => {
    const sources = {
      noctalia: import.meta.glob("../theme/builtin/noctalia/*.json", {
        eager: true,
        import: "default",
      }),
      community: import.meta.glob("../theme/builtin/community/*.json", {
        eager: true,
        import: "default",
      }),
      vaultdraw: import.meta.glob("../theme/builtin/*.json", {
        eager: true,
        import: "default",
      }),
    };
    // Paths as builtins.ts sees them ("./builtin/...").
    const rebased = Object.fromEntries(
      Object.entries(sources).map(([origin, files]) => [
        origin,
        Object.fromEntries(
          Object.entries(files).map(([path, json]) => [
            path.replace("../theme/", "./"),
            json,
          ]),
        ),
      ]),
    ) as typeof sources;
    const { authors, themes } = buildBuiltinIndex(rebased);
    // One theme per line: small in the bundle, readable in diffs.
    const expected = `{"authors":${JSON.stringify(authors)},"themes":[\n${themes
      .map((t) => JSON.stringify(t))
      .join(",\n")}\n]}\n`;
    if (process.env.UPDATE_THEME_INDEX) {
      writeFileSync(INDEX_PATH, expected);
    }
    expect(readFileSync(INDEX_PATH, "utf8")).toBe(expected);
  });
});

describe("lazy built-ins", () => {
  afterEach(() => resetBuiltinCaches());

  it("bundles exactly the eager set; the rest load on demand", async () => {
    resetBuiltinCaches();
    const eager = builtinThemeFiles()
      .filter((f) => isBuiltinThemeLoaded(f.id))
      .map((f) => f.id);
    expect(eager.sort()).toEqual([...EAGER_THEME_IDS].sort());
    expect(getBuiltinTheme("everforest")).toBeNull();
    const theme = await loadBuiltinTheme("everforest");
    expect(theme?.name).toBe("Everforest");
    expect(getBuiltinTheme("everforest")).toBe(theme);
    expect(await loadBuiltinTheme("nope")).toBeNull();
  });

  it("building the registry and the summaries parses nothing", async () => {
    resetBuiltinCaches();
    const registry = builtinRegistry();
    expect(registry.themes).toHaveLength(builtinThemeFiles().length);
    const summaries = listThemeSummaries(registry);
    expect(summaries).toHaveLength(registry.themes.length);
    expect(summaries[0]).toMatchObject({
      key: "Default",
      id: "default",
      source: "builtin",
      origin: "vaultdraw",
    });
    expect(parsedBuiltinCount()).toBe(0);

    // Selecting a theme parses just that one.
    const snap = computeAppearance(
      { theme: "dark", colorTheme: "Tokyo Night", syncCanvas: false },
      registry,
      window,
    );
    expect(snap.entry.id).toBe("tokyo-night");
    expect(snap.variant.mSurface).toBe(snap.entry.theme.dark.mSurface);
    expect(parsedBuiltinCount()).toBe(1);
    expect((await resolveTheme("dracula", registry))?.name).toBe("Dracula");
    expect(parsedBuiltinCount()).toBe(2);
    expect(await resolveTheme("nope", registry)).toBeNull();
  });

  it("a lazy theme shows Default until loaded, then announces itself", async () => {
    resetBuiltinCaches();
    const registry = builtinRegistry();
    setThemeRegistry(registry);
    const { entry } = resolveSelectedTheme(registry, "Everforest");
    expect(isThemeReady(entry)).toBe(false);
    const onChange = vi.fn();
    window.addEventListener(THEMES_CHANGED_EVENT, onChange);
    try {
      // Touching entry.theme falls back to Default and starts the load.
      expect(entry.theme.id).toBe("default");
      await loadThemeEntry(entry);
      expect(isThemeReady(entry)).toBe(true);
      expect(entry.theme.id).toBe("everforest");
      expect(onChange).toHaveBeenCalledTimes(1);
      // The cached registry is a new object so React state updates.
      const detail = onChange.mock.calls[0][0].detail;
      expect(detail).not.toBe(registry);
      expect(detail.themes).toBe(registry.themes);
      // Already loaded: no second event.
      await loadSelectedTheme(registry, "everforest");
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(THEMES_CHANGED_EVENT, onChange);
    }
  });

  it("summary previews match the fully resolved themes", async () => {
    await loadBuiltinThemes();
    for (const s of listThemeSummaries(builtinRegistry())) {
      const theme = getBuiltinTheme(s.id)!;
      expect(s.preview, s.id).toEqual(previewFromTheme(theme));
      expect(s.name).toBe(theme.name);
      expect(s.author).toBe(theme.author);
    }
  });

  it("startup: summaries for every built-in vs parsing every built-in", async () => {
    const median = (runs: number[]) => runs.sort((a, b) => a - b)[2];
    const summaries: number[] = [];
    const full: number[] = [];
    for (let i = 0; i < 5; i++) {
      resetBuiltinCaches();
      let t0 = performance.now();
      listThemeSummaries(builtinRegistry());
      summaries.push(performance.now() - t0);
      resetBuiltinCaches();
      t0 = performance.now();
      await loadBuiltinThemes();
      full.push(performance.now() - t0);
    }
    // eslint-disable-next-line no-console
    console.info(
      `[theme startup] ${
        builtinThemeFiles().length
      } built-ins: summaries ${median(summaries).toFixed(
        2,
      )} ms (median of 5), load + parse all ${median(full).toFixed(2)} ms`,
    );
    expect(median(summaries)).toBeLessThan(median(full));
  });
});
