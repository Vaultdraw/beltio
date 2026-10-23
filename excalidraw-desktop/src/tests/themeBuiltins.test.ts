/**
 * Bundled themes: sources and clash rules, lazy parsing, cheap summaries,
 * and the startup cost of building the theme list.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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
  listThemeSummaries,
  resolveSelectedTheme,
  resolveTheme,
  setThemeRegistry,
} from "../theme/registry";
import { computeAppearance } from "../vault/appearance";

afterEach(() => setThemeRegistry(null));

const NOCTALIA = [
  "catppuccin",
  "dracula",
  "gruvbox",
  "kanagawa",
  "nord",
  "tokyo-night",
];

describe("bundled theme sources", () => {
  const files = builtinThemeFiles();
  const origin = (id: string) => files.find((f) => f.id === id)?.origin;

  it("bundles exactly the ten most popular themes", () => {
    expect(files.map((f) => f.id)).toEqual([...EAGER_THEME_IDS]);
    expect(files).toHaveLength(10);
    expect(files[0].id).toBe("default");
  });

  it("Noctalia's palettes, three community palettes and Default", () => {
    for (const id of NOCTALIA) {
      expect(origin(id), id).toBe("noctalia");
      expect(files.find((f) => f.id === id)?.author).toMatch(
        /^Noctalia \(MIT\)/,
      );
    }
    for (const id of ["everforest", "one-dark", "solarized"]) {
      expect(origin(id), id).toBe("community");
      expect(files.find((f) => f.id === id)?.author).toBe(
        "Noctalia community palettes",
      );
    }
    expect(
      files.filter((f) => f.origin === "vaultdraw").map((f) => f.id),
    ).toEqual(["default"]);
  });

  it("old names still select a bundled theme", () => {
    const registry = builtinRegistry();
    expect(resolveSelectedTheme(registry, "One").entry.id).toBe("one-dark");
    expect(resolveSelectedTheme(registry, "Everforest Alt").entry.id).toBe(
      "everforest",
    );
    expect(resolveSelectedTheme(registry, "One").problem).toBeNull();
  });

  it("every bundled palette parses without warnings that need a fix", async () => {
    for (const t of await loadBuiltinThemes()) {
      for (const w of t.warnings) {
        expect(w, t.id).toMatch(/low contrast|is too (light|dark) for/);
      }
    }
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

describe("built-in loading", () => {
  afterEach(() => resetBuiltinCaches());

  it("every bundled theme is ready; unknown ids are null", async () => {
    resetBuiltinCaches();
    for (const f of builtinThemeFiles()) {
      expect(isBuiltinThemeLoaded(f.id), f.id).toBe(true);
    }
    const theme = await loadBuiltinTheme("everforest");
    expect(theme?.name).toBe("Everforest");
    expect(getBuiltinTheme("everforest")).toBe(theme);
    expect(await loadBuiltinTheme("nope")).toBeNull();
    expect(getBuiltinTheme("rose-pine")).toBeNull();
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

  it("summary previews match the fully resolved themes", async () => {
    await loadBuiltinThemes();
    for (const s of listThemeSummaries(builtinRegistry())) {
      const theme = getBuiltinTheme(s.id)!;
      expect(s.preview, s.id).toEqual(previewFromTheme(theme));
      expect(s.name).toBe(theme.name);
      expect(s.author).toBe(theme.author);
    }
  });
});
