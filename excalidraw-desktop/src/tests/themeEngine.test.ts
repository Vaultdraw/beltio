/**
 * Theme engine: parsing/validation, derivation, generated variants, UI token
 * contrast guarantees (built-ins + 200 seeded random themes), Excalidraw
 * variable mapping and DOM application.
 */
import { describe, expect, it } from "vitest";

import {
  ANSI_KEYS,
  CONTRAST,
  EXCALIDRAW_OVERRIDE_STYLE_ID,
  NON_HEX_TOKENS,
  ROLE_KEYS,
  TERMINAL_EXTRA_KEYS,
  TOKEN_NAMES,
  applyThemeTokens,
  contrastRatio,
  deriveTokens,
  excalidrawVariableOverrides,
  hexToOklab,
  hexToOklch,
  isHexColor,
  loadBuiltinThemes,
  oklchToHex,
  parseThemeFile,
} from "../theme";

import type { ResolvedTheme, ThemeMode, ThemeVariant } from "../theme";

const prng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const MODES: ThemeMode[] = ["dark", "light"];

/** A palette exactly as Noctalia ships it (all roles + terminal; mixed-case hex). */
const NOCTALIA_FILE = {
  dark: {
    mPrimary: "#FFF59B",
    mOnPrimary: "#0E0E43",
    mSecondary: "#A9AEFE",
    mOnSecondary: "#0E0E43",
    mTertiary: "#9BFECE",
    mOnTertiary: "#0E0E43",
    mError: "#FD4663",
    mOnError: "#0E0E43",
    mSurface: "#070722",
    mOnSurface: "#F3EDF7",
    mSurfaceVariant: "#11112D",
    mOnSurfaceVariant: "#7C80B4",
    mOutline: "#21215F",
    mShadow: "#070722",
    mHover: "#9BFECE",
    mOnHover: "#0E0E43",
    terminal: {
      normal: {
        black: "#11112d",
        red: "#fd4663",
        green: "#9bfece",
        yellow: "#fff59b",
        blue: "#a9aefe",
        magenta: "#e0b7c9",
        cyan: "#9bfece",
        white: "#f3edf7",
      },
      bright: {
        black: "#21215f",
        red: "#fe6f84",
        green: "#b4ffdb",
        yellow: "#fff8b5",
        blue: "#c0c3fe",
        magenta: "#ebcbd9",
        cyan: "#b4ffdb",
        white: "#ffffff",
      },
      foreground: "#f3edf7",
      background: "#070722",
      selectionFg: "#070722",
      selectionBg: "#a9aefe",
      cursorText: "#070722",
      cursor: "#f3edf7",
    },
  },
  light: {
    mPrimary: "#5d65f5",
    mOnPrimary: "#dadcff",
    mSecondary: "#8E93D8",
    mOnSecondary: "#f3edf7",
    mTertiary: "#0E0E43",
    mOnTertiary: "#fefefe",
    mError: "#FD4663",
    mOnError: "#11112d",
    mSurface: "#e6e8fa",
    mOnSurface: "#0e0e43",
    mSurfaceVariant: "#eff0ff",
    mOnSurfaceVariant: "#7c80b4",
    mOutline: "#a8aefe",
    mShadow: "#f3edf7",
    mHover: "#0E0E43",
    mOnHover: "#fefefe",
  },
};

const allVariantColors = (v: ThemeVariant) => [
  ...ROLE_KEYS.map((k) => v[k]),
  ...ANSI_KEYS.flatMap((k) => [v.terminal.normal[k], v.terminal.bright[k]]),
  ...TERMINAL_EXTRA_KEYS.map((k) => v.terminal[k]),
];

const expectResolved = (theme: ResolvedTheme) => {
  for (const mode of MODES) {
    for (const c of allVariantColors(theme[mode])) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  }
};

const expectTokenGuarantees = (
  variant: ThemeVariant,
  mode: ThemeMode,
  label: string,
) => {
  const t = deriveTokens(variant, mode);
  for (const name of TOKEN_NAMES) {
    expect(t[name], `${label} ${name}`).toBeTruthy();
    if (!NON_HEX_TOKENS.has(name)) {
      expect(isHexColor(t[name]), `${label} ${name}=${t[name]}`).toBe(true);
    }
  }
  expect(t["--vault-canvas"]).toBe(variant.mSurface);
  for (const bg of [
    "--vault-bg",
    "--vault-surface",
    "--vault-menu-bg",
  ] as const) {
    const ctx = `${label} on ${bg}`;
    expect(contrastRatio(t["--vault-text"], t[bg]), ctx).toBeGreaterThanOrEqual(
      CONTRAST.text,
    );
    expect(
      contrastRatio(t["--vault-text-muted"], t[bg]),
      ctx,
    ).toBeGreaterThanOrEqual(CONTRAST.muted);
    expect(
      contrastRatio(t["--vault-text-faint"], t[bg]),
      ctx,
    ).toBeGreaterThanOrEqual(CONTRAST.faint);
  }
  expect(
    contrastRatio(t["--vault-on-primary"], t["--vault-primary"]),
    label,
  ).toBeGreaterThanOrEqual(CONTRAST.onPrimary);
  for (const s of ["success", "warning", "danger"] as const) {
    expect(
      contrastRatio(t[`--vault-${s}`], t[`--vault-${s}-bg`]),
      `${label} ${s}`,
    ).toBeGreaterThanOrEqual(CONTRAST.status);
  }
  return t;
};

const ALL_BUILTINS = await loadBuiltinThemes();

describe("built-in themes", () => {
  const themes = ALL_BUILTINS;

  it("ships the bundled palettes, all hand-authored in both modes", async () => {
    const ids = themes.map((t) => t.id);
    expect(ids[0]).toBe("default");
    expect(ids.length).toBeGreaterThanOrEqual(100);
    expect(new Set(ids).size).toBe(ids.length);
    // Noctalia's built-ins (MIT) are all present.
    for (const id of [
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
    ]) {
      expect(ids).toContain(id);
    }
    // Default first, then by name.
    const names = themes.slice(1).map((t) => t.name);
    expect(names).toEqual(
      [...names].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      ),
    );
    for (const t of themes) {
      expect(t.generated).toEqual({ dark: false, light: false });
      expect(t.author).toBeTruthy();
      expectResolved(t);
      expect(hexToOklab(t.dark.mSurface).l).toBeLessThan(
        hexToOklab(t.light.mSurface).l,
      );
    }
    expect(await loadBuiltinThemes()).toEqual(themes);
  });

  it("Default reproduces the app's current look", () => {
    const d = themes[0];
    expect(d.light.mPrimary).toBe("#6965db");
    expect(d.dark.mPrimary).toBe("#8e8bf0");
    const light = deriveTokens(d.light, "light");
    const dark = deriveTokens(d.dark, "dark");
    expect(light["--vault-bg"]).toBe("#ffffff");
    expect(light["--vault-text"]).toBe("#1d1d20");
    expect(light["--vault-text-muted"]).toBe("#64646d");
    expect(light["--vault-primary"]).toBe("#6965db");
    expect(light["--vault-on-primary"]).toBe("#ffffff");
    expect(dark["--vault-bg"]).toBe("#121212");
    expect(dark["--vault-text"]).toBe("#e6e6e9");
    expect(dark["--vault-primary"]).toBe("#8e8bf0");
  });

  it.each(themes.flatMap((t) => MODES.map((m) => [t.id, m] as const)))(
    "%s (%s) meets every contrast guarantee",
    (id, mode) => {
      const theme = themes.find((t) => t.id === id) as ResolvedTheme;
      expectTokenGuarantees(theme[mode], mode, `${id}/${mode}`);
    },
  );
});

describe("random seed themes", () => {
  it("200 seeded random themes resolve and meet every guarantee in both modes", () => {
    const rand = prng(20261013);
    const color = (l: [number, number], c: [number, number]) =>
      oklchToHex({
        l: l[0] + rand() * (l[1] - l[0]),
        c: c[0] + rand() * (c[1] - c[0]),
        h: rand() * 360,
      });
    for (let i = 0; i < 200; i++) {
      const variant = (mode: ThemeMode) => {
        // Deliberately include awkward inputs: mid-grey surfaces, low-contrast text.
        const surface =
          mode === "dark"
            ? color([0.05, 0.6], [0, 0.08])
            : color([0.55, 1], [0, 0.08]);
        return {
          mSurface: surface,
          mOnSurface: color([0, 1], [0, 0.1]),
          mPrimary: color([0.2, 0.95], [0, 0.3]),
        };
      };
      const pick = rand();
      const file =
        pick < 1 / 3
          ? { dark: variant("dark") }
          : pick < 2 / 3
          ? { light: variant("light") }
          : { dark: variant("dark"), light: variant("light") };
      const theme = parseThemeFile(file, `Random ${i}`);
      expectResolved(theme);
      for (const mode of MODES) {
        expectTokenGuarantees(theme[mode], mode, `random#${i}/${mode}`);
        const vars = excalidrawVariableOverrides(
          deriveTokens(theme[mode], mode),
          mode,
        );
        expect(Object.values(vars).every(Boolean)).toBe(true);
      }
    }
  });
});

describe("parseThemeFile", () => {
  it("accepts a real Noctalia palette unchanged (values only lower-cased)", () => {
    const theme = parseThemeFile(NOCTALIA_FILE, "Noctalia-default");
    expect(theme.name).toBe("Noctalia-default");
    expect(theme.id).toBe("noctalia-default");
    expect(theme.generated).toEqual({ dark: false, light: false });
    for (const mode of MODES) {
      const src = NOCTALIA_FILE[mode] as Record<string, unknown>;
      for (const key of ROLE_KEYS) {
        expect(theme[mode][key]).toBe((src[key] as string).toLowerCase());
      }
    }
    expect(theme.dark.terminal).toEqual(NOCTALIA_FILE.dark.terminal);
    // light had no terminal block: derived, with foreground/background from roles
    expect(theme.light.terminal.background).toBe("#e6e8fa");
    expect(theme.light.terminal.foreground).toBe("#0e0e43");
    expect(theme.warnings.filter((w) => w.includes("unknown"))).toEqual([]);
  });

  it("derives every missing role from the three required ones", () => {
    const theme = parseThemeFile(
      {
        name: "Mini",
        author: "me",
        dark: {
          mSurface: "#1a1b26",
          mOnSurface: "#c0caf5",
          mPrimary: "#7aa2f7",
        },
        light: {
          mSurface: "#e1e2e7",
          mOnSurface: "#3760bf",
          mPrimary: "#2e7de9",
        },
      },
      "ignored",
    );
    expect(theme.name).toBe("Mini");
    expect(theme.author).toBe("me");
    expectResolved(theme);
    for (const mode of MODES) {
      const v = theme[mode];
      expect(contrastRatio(v.mOnPrimary, v.mPrimary)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(v.mOnError, v.mError)).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(v.mOnSurfaceVariant, v.mSurface),
      ).toBeGreaterThanOrEqual(4.5);
      for (const k of [
        "red",
        "green",
        "yellow",
        "blue",
        "magenta",
        "cyan",
      ] as const) {
        expect(
          contrastRatio(v.terminal.normal[k], v.mSurface),
        ).toBeGreaterThanOrEqual(3);
      }
      expect(v.mHover).toBe(v.mTertiary);
    }
    // synthesised terminal hues sit near their names
    const h = hexToOklch(theme.dark.terminal.normal.green).h;
    expect(h).toBeGreaterThan(120);
    expect(h).toBeLessThan(170);
  });

  it("generates the light variant when only dark is given", () => {
    const theme = parseThemeFile(
      {
        dark: {
          mSurface: "#282a36",
          mOnSurface: "#f8f8f2",
          mPrimary: "#bd93f9",
        },
      },
      "Dark only",
    );
    expect(theme.generated).toEqual({ dark: false, light: true });
    expect(theme.warnings).toContain("light: generated from the dark variant");
    expectResolved(theme);
    const light = theme.light;
    expect(hexToOklab(light.mSurface).l).toBeGreaterThan(0.9);
    expect(hexToOklab(light.mOnSurface).l).toBeLessThan(0.45);
    // hue kept for the accent, and it still reads on the new surface
    const hueDiff = Math.abs(
      hexToOklch(light.mPrimary).h - hexToOklch("#bd93f9").h,
    );
    expect(Math.min(hueDiff, 360 - hueDiff)).toBeLessThan(8);
    expect(
      contrastRatio(light.mPrimary, light.mSurface),
    ).toBeGreaterThanOrEqual(3);
    // surface keeps its (bluish-purple) hue family
    const sh = Math.abs(hexToOklch(light.mSurface).h - hexToOklch("#282a36").h);
    expect(Math.min(sh, 360 - sh)).toBeLessThan(15);
  });

  it("generates the dark variant when only light is given", () => {
    const theme = parseThemeFile(
      {
        light: {
          mSurface: "#fdf6e3",
          mOnSurface: "#657b83",
          mPrimary: "#268bd2",
        },
      },
      "Light only",
    );
    expect(theme.generated).toEqual({ dark: true, light: false });
    expectResolved(theme);
    expect(hexToOklab(theme.dark.mSurface).l).toBeLessThan(0.3);
    expect(hexToOklab(theme.dark.mOnSurface).l).toBeGreaterThan(0.8);
    expect(
      contrastRatio(theme.dark.mPrimary, theme.dark.mSurface),
    ).toBeGreaterThanOrEqual(3);
  });

  it("accepts #rgb and #rrggbbaa, normalising to #rrggbb", () => {
    const theme = parseThemeFile(
      { dark: { mSurface: "#111", mOnSurface: "#EEEEEEFF", mPrimary: "#88f" } },
      "Short",
    );
    expect(theme.dark.mSurface).toBe("#111111");
    expect(theme.dark.mOnSurface).toBe("#eeeeee");
    expect(theme.dark.mPrimary).toBe("#8888ff");
  });

  it("warns (doesn't fail) on unknown keys and low-contrast explicit pairs", () => {
    const theme = parseThemeFile(
      {
        $schema: "x",
        version: 2,
        dark: {
          mSurface: "#000000",
          mOnSurface: "#222222",
          mPrimary: "#7aa2f7",
          extra: 1,
        },
      },
      "Warned",
    );
    expect(theme.warnings).toEqual(
      expect.arrayContaining([
        "version: unknown key ignored",
        "dark.extra: unknown key ignored",
        expect.stringContaining("dark.mOnSurface on mSurface has low contrast"),
      ]),
    );
  });

  it("repairs a surface that can't carry readable text for its mode", () => {
    const theme = parseThemeFile(
      {
        dark: {
          mSurface: "#eeeeee",
          mOnSurface: "#ffffff",
          mPrimary: "#7aa2f7",
        },
      },
      "Wrong",
    );
    expect(
      contrastRatio("#ffffff", theme.dark.mSurface),
    ).toBeGreaterThanOrEqual(9);
    expect(
      theme.warnings.some((w) => w.includes("too light for a dark theme")),
    ).toBe(true);
  });

  describe("validation errors are clear", () => {
    const err = (json: unknown) => () => parseThemeFile(json, "Bad");
    it("not an object", () => {
      expect(err(null)).toThrow(/Theme "Bad": expected a JSON object/);
      expect(err([1])).toThrow(/expected a JSON object/);
    });
    it("no variant", () => {
      expect(err({ name: "X" })).toThrow(
        'Theme "X": needs a "dark" or "light" block (or both), each with at least mSurface, mOnSurface, mPrimary',
      );
    });
    it("missing required roles", () => {
      expect(err({ dark: { mSurface: "#000000" } })).toThrow(
        'Theme "Bad": "dark" is missing required colours mOnSurface, mPrimary (required: mSurface, mOnSurface, mPrimary)',
      );
      expect(err({ light: { mSurface: "#fff", mOnSurface: "#000" } })).toThrow(
        /"light" is missing required colour mPrimary/,
      );
    });
    it("bad colour values name the exact path", () => {
      expect(
        err({
          dark: { mSurface: "navy", mOnSurface: "#fff", mPrimary: "#f00" },
        }),
      ).toThrow(
        'Theme "Bad": dark.mSurface must be a hex colour like "#rrggbb" (got "navy")',
      );
      expect(
        err({
          dark: {
            mSurface: "#000",
            mOnSurface: "#fff",
            mPrimary: "#f00",
            terminal: { normal: { red: "#12" } },
          },
        }),
      ).toThrow(
        'dark.terminal.normal.red must be a hex colour like "#rrggbb" (got "#12")',
      );
      expect(
        err({ dark: { mSurface: "#000", mOnSurface: "#fff", mPrimary: 12 } }),
      ).toThrow("dark.mPrimary must be a hex colour");
    });
    it("bad shapes", () => {
      expect(err({ dark: "nope" })).toThrow('"dark" must be an object');
      expect(
        err({
          dark: {
            mSurface: "#000",
            mOnSurface: "#fff",
            mPrimary: "#f00",
            terminal: [],
          },
        }),
      ).toThrow("dark.terminal must be an object");
      expect(err({ name: 3, dark: {} })).toThrow(
        '"name" must be a non-empty string',
      );
    });
  });
});

describe("Excalidraw variable overrides", () => {
  it("maps tokens onto Excalidraw's UI variables in both modes", () => {
    const theme = ALL_BUILTINS.find(
      (t) => t.id === "tokyo-night",
    ) as ResolvedTheme;
    for (const mode of MODES) {
      const tokens = deriveTokens(theme[mode], mode);
      const vars = excalidrawVariableOverrides(tokens, mode);
      // islands = surface-variant + 1 px island shadow (popovers: chrome css)
      expect(vars["--island-bg-color"]).toBe(tokens["--vault-surface"]);
      expect(vars["--shadow-island"]).toBe(tokens["--vault-shadow-island"]);
      expect(vars["--button-hover-bg"]).toBe(tokens["--vault-hover"]);
      expect(vars["--color-surface-primary-container"]).toBe(
        tokens["--vault-sel"],
      );
      expect(vars["--color-on-primary-container"]).toBe(tokens["--vault-text"]);
      expect(vars["--lg-button-size"]).toBe("2rem");
      expect(vars["--color-primary"]).toBe(tokens["--vault-primary"]);
      expect(vars["--text-primary-color"]).toBe(tokens["--vault-text"]);
      expect(vars["--color-on-surface"]).toBe(tokens["--vault-text"]);
      expect(vars["--sidebar-bg-color"]).toBe(tokens["--vault-surface"]);
      expect(vars["--default-bg-color"]).toBe(tokens["--vault-canvas"]);
      expect(vars["--color-selection"]).toBe(tokens["--vault-primary"]);
      for (const [k, v] of Object.entries(vars)) {
        expect(k.startsWith("--")).toBe(true);
        expect(v).toBeTruthy();
      }
    }
  });
});

describe("applyThemeTokens", () => {
  it("sets inline variables + an override stylesheet, and restores both", () => {
    const root = document.documentElement;
    root.style.setProperty("--vault-text", "#123456");
    const theme = ALL_BUILTINS[1];
    const tokens = deriveTokens(theme.dark, "dark");
    const vars = excalidrawVariableOverrides(tokens, "dark");

    const handle = applyThemeTokens(document, tokens, vars);
    expect(root.style.getPropertyValue("--vault-text")).toBe(
      tokens["--vault-text"],
    );
    expect(root.style.getPropertyValue("--island-bg-color")).toBe(
      vars["--island-bg-color"],
    );
    expect(handle.previous["--vault-text"]).toBe("#123456");
    expect(handle.previous["--vault-bg"]).toBe("");
    const style = document.getElementById(EXCALIDRAW_OVERRIDE_STYLE_ID);
    expect(style?.textContent).toContain(":root .excalidraw.theme--dark");
    expect(style?.textContent).toContain(
      `--island-bg-color: ${vars["--island-bg-color"]};`,
    );

    // re-applying reuses the same <style>
    const second = applyThemeTokens(document, tokens, vars);
    expect(
      document.querySelectorAll(`#${EXCALIDRAW_OVERRIDE_STYLE_ID}`),
    ).toHaveLength(1);
    second.restore();
    handle.restore();

    expect(root.style.getPropertyValue("--vault-text")).toBe("#123456");
    expect(root.style.getPropertyValue("--vault-bg")).toBe("");
    expect(document.getElementById(EXCALIDRAW_OVERRIDE_STYLE_ID)).toBeNull();
    root.style.removeProperty("--vault-text");
  });
});
