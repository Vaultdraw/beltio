/**
 * Parsing, validation and derivation of theme files.
 *
 * Accepts real Noctalia palette files unchanged (every role present) as well
 * as minimal files with just `mSurface`, `mOnSurface` and `mPrimary` per
 * variant. Any missing role / terminal colour is derived; a missing variant
 * (dark or light) is generated from the other one.
 */

import {
  bestExtreme,
  contrastRatio,
  ensureContrast,
  hexToOklch,
  mix,
  normalizeHex,
  oklchToHex,
  pickOn,
  rotateHue,
} from "./color";
import { readMarkdownInput } from "./markdown";
import {
  ANSI_KEYS,
  REQUIRED_ROLE_KEYS,
  ROLE_KEYS,
  TERMINAL_EXTRA_KEYS,
  THEME_MODES,
} from "./types";

import type {
  AnsiColors,
  AnsiKey,
  ResolvedTheme,
  RoleKey,
  TerminalColors,
  ThemeMode,
  ThemeVariant,
  ThemeVariantInput,
} from "./types";

/** Reference OKLCH hues used when a terminal colour has to be synthesised. */
export const ANSI_HUES: Record<Exclude<AnsiKey, "black" | "white">, number> = {
  red: 25,
  yellow: 90,
  green: 145,
  cyan: 205,
  blue: 255,
  magenta: 330,
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const slugify = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "theme";

class ThemeParseError extends Error {
  constructor(themeName: string, message: string) {
    super(`Theme "${themeName}": ${message}`);
    this.name = "ThemeParseError";
  }
}

const readColor = (value: unknown, path: string, themeName: string): string => {
  const hex = typeof value === "string" ? normalizeHex(value) : null;
  if (!hex) {
    throw new ThemeParseError(
      themeName,
      `${path} must be a hex colour like "#rrggbb" (got ${JSON.stringify(
        value,
      )})`,
    );
  }
  return hex;
};

// ---------------------------------------------------------------------------
// Reading (validation only, no derivation)
// ---------------------------------------------------------------------------

const readVariantInput = (
  raw: unknown,
  mode: ThemeMode,
  themeName: string,
  warnings: string[],
): ThemeVariantInput => {
  if (!isPlainObject(raw)) {
    throw new ThemeParseError(
      themeName,
      `"${mode}" must be an object of colour roles`,
    );
  }
  const missing = REQUIRED_ROLE_KEYS.filter((k) => raw[k] === undefined);
  if (missing.length) {
    throw new ThemeParseError(
      themeName,
      `"${mode}" is missing required colour${
        missing.length > 1 ? "s" : ""
      } ${missing.join(", ")} (required: ${REQUIRED_ROLE_KEYS.join(", ")})`,
    );
  }
  const out: ThemeVariantInput = {};
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if ((ROLE_KEYS as readonly string[]).includes(key)) {
      if (value === undefined) {
        continue;
      }
      out[key as RoleKey] = readColor(value, `${mode}.${key}`, themeName);
    } else if (key === "terminal") {
      out.terminal = readTerminalInput(value, mode, themeName, warnings);
    } else if (key === "markdown") {
      const md = readMarkdownInput(value, `${mode}.markdown`, warnings);
      if (md && Object.keys(md).length > 0) {
        out.markdown = md;
      }
    } else {
      warnings.push(`${mode}.${key}: unknown key ignored`);
    }
  }
  return out;
};

const readTerminalInput = (
  raw: unknown,
  mode: ThemeMode,
  themeName: string,
  warnings: string[],
): NonNullable<ThemeVariantInput["terminal"]> => {
  if (!isPlainObject(raw)) {
    throw new ThemeParseError(themeName, `${mode}.terminal must be an object`);
  }
  const out: NonNullable<ThemeVariantInput["terminal"]> = {};
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    const path = `${mode}.terminal.${key}`;
    if (key === "normal" || key === "bright") {
      if (!isPlainObject(value)) {
        throw new ThemeParseError(themeName, `${path} must be an object`);
      }
      const set: Partial<AnsiColors> = {};
      for (const ansi of Object.keys(value)) {
        if ((ANSI_KEYS as readonly string[]).includes(ansi)) {
          set[ansi as AnsiKey] = readColor(
            value[ansi],
            `${path}.${ansi}`,
            themeName,
          );
        } else {
          warnings.push(`${path}.${ansi}: unknown key ignored`);
        }
      }
      out[key] = set;
    } else if ((TERMINAL_EXTRA_KEYS as readonly string[]).includes(key)) {
      out[key as typeof TERMINAL_EXTRA_KEYS[number]] = readColor(
        value,
        path,
        themeName,
      );
    } else {
      warnings.push(`${path}: unknown key ignored`);
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** Minimum contrast between text and the extreme (white/black) a surface must allow. */
const SURFACE_HEADROOM = 9;

/**
 * A dark variant needs a surface white text can reach ≥ 9:1 on (and a light
 * one black text), otherwise no text colour can satisfy the 7:1 guarantee.
 */
const fixSurface = (surface: string, mode: ThemeMode, warnings: string[]) => {
  const extreme = mode === "dark" ? "#ffffff" : "#000000";
  if (contrastRatio(extreme, surface) >= SURFACE_HEADROOM) {
    return surface;
  }
  const fixed = ensureContrast(surface, extreme, SURFACE_HEADROOM);
  warnings.push(
    `${mode}.mSurface ${surface} is too ${
      mode === "dark" ? "light for a dark" : "dark for a light"
    } theme; using ${fixed}`,
  );
  return fixed;
};

/** Synthesises a colour at `hue` with the accent's lightness/chroma, readable on the surface. */
const synthAccent = (
  hue: number,
  primary: string,
  surface: string,
  minContrast: number,
): string => {
  const p = hexToOklch(primary);
  const c = Math.min(0.2, Math.max(0.09, p.c));
  return ensureContrast(
    oklchToHex({ l: p.l, c, h: hue }),
    surface,
    minContrast,
  );
};

const deriveTerminal = (
  input: ThemeVariantInput["terminal"],
  roles: Record<RoleKey, string>,
  mode: ThemeMode,
): TerminalColors => {
  const { mSurface: surface, mOnSurface: text, mPrimary: primary } = roles;
  const darkEnd = mode === "dark" ? surface : text;
  const lightEnd = mode === "dark" ? text : surface;
  const away = mode === "dark" ? 1 : -1;

  const normal = {} as AnsiColors;
  const bright = {} as AnsiColors;
  for (const key of ANSI_KEYS) {
    let n: string;
    let b: string;
    if (key === "black") {
      n = mix(darkEnd, lightEnd, 0.12);
      b = mix(darkEnd, lightEnd, 0.35);
    } else if (key === "white") {
      n = mix(lightEnd, darkEnd, 0.15);
      b = lightEnd;
    } else {
      const fromRole = key === "red" ? roles.mError : null;
      n = fromRole ?? synthAccent(ANSI_HUES[key], primary, surface, 3);
      const lch = hexToOklch(n);
      b = ensureContrast(
        oklchToHex({
          ...lch,
          l: Math.min(1, Math.max(0, lch.l + 0.07 * away)),
        }),
        surface,
        3,
      );
    }
    normal[key] = input?.normal?.[key] ?? n;
    bright[key] = input?.bright?.[key] ?? input?.normal?.[key] ?? b;
  }
  return {
    normal,
    bright,
    foreground: input?.foreground ?? text,
    background: input?.background ?? surface,
    selectionFg: input?.selectionFg ?? text,
    selectionBg: input?.selectionBg ?? mix(surface, primary, 0.3),
    cursorText: input?.cursorText ?? surface,
    cursor: input?.cursor ?? text,
  };
};

/** Fills every missing role and terminal colour of a validated variant. */
export const resolveVariant = (
  input: ThemeVariantInput,
  mode: ThemeMode,
  warnings: string[] = [],
): ThemeVariant => {
  const surface = fixSurface(input.mSurface as string, mode, warnings);
  const onSurface = input.mOnSurface as string;
  const primary = input.mPrimary as string;
  const t = input.terminal;
  const on = (bg: string) =>
    pickOn(bg, [surface, onSurface, bestExtreme(bg)], 4.5);

  const secondary =
    input.mSecondary ?? ensureContrast(rotateHue(primary, 60), surface, 3);
  const tertiary =
    input.mTertiary ?? ensureContrast(rotateHue(primary, -60), surface, 3);
  const error =
    input.mError ??
    t?.normal?.red ??
    synthAccent(ANSI_HUES.red, primary, surface, 3);
  const onTertiary = input.mOnTertiary ?? on(tertiary);
  const hover = input.mHover ?? tertiary;

  const roles: Record<RoleKey, string> = {
    mPrimary: primary,
    mOnPrimary: input.mOnPrimary ?? on(primary),
    mSecondary: secondary,
    mOnSecondary: input.mOnSecondary ?? on(secondary),
    mTertiary: tertiary,
    mOnTertiary: onTertiary,
    mError: error,
    mOnError: input.mOnError ?? on(error),
    mSurface: surface,
    mOnSurface: onSurface,
    mSurfaceVariant: input.mSurfaceVariant ?? mix(surface, onSurface, 0.08),
    mOnSurfaceVariant:
      input.mOnSurfaceVariant ??
      ensureContrast(mix(onSurface, surface, 0.3), surface, 4.5),
    mOutline: input.mOutline ?? mix(surface, onSurface, 0.3),
    mShadow: input.mShadow ?? "#000000",
    mHover: hover,
    mOnHover:
      input.mOnHover ?? (input.mHover === undefined ? onTertiary : on(hover)),
  };

  const pairs: Array<[RoleKey, RoleKey, number]> = [
    ["mOnSurface", "mSurface", 4.5],
    ["mOnPrimary", "mPrimary", 3],
  ];
  for (const [fg, bg, min] of pairs) {
    if (input[fg] !== undefined) {
      const r = contrastRatio(roles[fg], roles[bg]);
      if (r < min) {
        warnings.push(
          `${mode}.${fg} on ${bg} has low contrast (${r.toFixed(
            2,
          )}:1); UI tokens will adjust it`,
        );
      }
    }
  }

  return {
    ...roles,
    terminal: deriveTerminal(t, roles, mode),
    ...(input.markdown ? { markdown: { ...input.markdown } } : {}),
  };
};

// ---------------------------------------------------------------------------
// Generating the missing variant
// ---------------------------------------------------------------------------

/** Target OKLCH lightness of surface / text in a generated variant. */
const GENERATED_L: Record<ThemeMode, { surface: number; text: number }> = {
  light: { surface: 0.975, text: 0.3 },
  dark: { surface: 0.2, text: 0.92 },
};

/**
 * Builds the other mode from a resolved variant: surfaces and text get their
 * OKLCH lightness flipped (mapped linearly from the source surface→text range
 * onto the target one) with hues kept and chroma capped; accents keep hue and
 * chroma and are nudged until they read ≥ 3:1 on the new surface. On-colours
 * and anything else are then re-derived.
 */
export const generateVariant = (
  from: ThemeVariant,
  toMode: ThemeMode,
): ThemeVariantInput => {
  const src = {
    s: hexToOklch(from.mSurface).l,
    t: hexToOklch(from.mOnSurface).l,
  };
  const dst = GENERATED_L[toMode];
  const span = src.t - src.s || (toMode === "light" ? -1 : 1);

  const flip = (hex: string, maxChroma: number) => {
    const lch = hexToOklch(hex);
    const u = Math.max(-0.25, Math.min(1.25, (lch.l - src.s) / span));
    return oklchToHex({
      l: dst.surface + u * (dst.text - dst.surface),
      c: Math.min(lch.c, maxChroma),
      h: lch.h,
    });
  };

  const surface = flip(from.mSurface, 0.03);
  const accent = (hex: string) => ensureContrast(hex, surface, 3);

  const ansi = (set: AnsiColors) => {
    const out: Partial<AnsiColors> = {};
    for (const key of ANSI_KEYS) {
      if (key !== "black" && key !== "white") {
        out[key] = accent(set[key]);
      }
    }
    return out;
  };

  const hoverIsTertiary = from.mHover === from.mTertiary;

  return {
    mSurface: surface,
    mOnSurface: flip(from.mOnSurface, 0.08),
    mSurfaceVariant: flip(from.mSurfaceVariant, 0.04),
    mOnSurfaceVariant: flip(from.mOnSurfaceVariant, 0.08),
    mOutline: flip(from.mOutline, 0.06),
    mShadow: "#000000",
    mPrimary: accent(from.mPrimary),
    mSecondary: accent(from.mSecondary),
    mTertiary: accent(from.mTertiary),
    mError: accent(from.mError),
    ...(hoverIsTertiary ? {} : { mHover: accent(from.mHover) }),
    terminal: {
      normal: ansi(from.terminal.normal),
      bright: ansi(from.terminal.bright),
    },
  };
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Validates and resolves a theme file.
 *
 * @param json parsed JSON (Noctalia palette or relaxed file)
 * @param fallbackName name to use when the file has no `name` (Noctalia infers it from the file name)
 * @throws Error with a clear message for missing required keys, bad colours or a malformed shape
 */
export const parseThemeFile = (
  json: unknown,
  fallbackName: string,
): ResolvedTheme => {
  if (!isPlainObject(json)) {
    throw new ThemeParseError(
      fallbackName,
      `expected a JSON object with "dark" and/or "light" blocks`,
    );
  }
  if (
    json.name !== undefined &&
    (typeof json.name !== "string" || !json.name.trim())
  ) {
    throw new ThemeParseError(
      fallbackName,
      `"name" must be a non-empty string`,
    );
  }
  if (json.author !== undefined && typeof json.author !== "string") {
    throw new ThemeParseError(fallbackName, `"author" must be a string`);
  }
  const name = (json.name as string | undefined)?.trim() || fallbackName;
  const warnings: string[] = [];

  for (const key of Object.keys(json)) {
    if (!["name", "author", "dark", "light", "$schema"].includes(key)) {
      warnings.push(`${key}: unknown key ignored`);
    }
  }

  const inputs: Partial<Record<ThemeMode, ThemeVariantInput>> = {};
  for (const mode of THEME_MODES) {
    if (json[mode] !== undefined) {
      inputs[mode] = readVariantInput(json[mode], mode, name, warnings);
    }
  }
  if (!inputs.dark && !inputs.light) {
    throw new ThemeParseError(
      name,
      `needs a "dark" or "light" block (or both), each with at least ${REQUIRED_ROLE_KEYS.join(
        ", ",
      )}`,
    );
  }

  const resolved: Partial<Record<ThemeMode, ThemeVariant>> = {};
  for (const mode of THEME_MODES) {
    const input = inputs[mode];
    if (input) {
      resolved[mode] = resolveVariant(input, mode, warnings);
    }
  }
  const generated = { dark: !resolved.dark, light: !resolved.light };
  if (!resolved.dark) {
    resolved.dark = resolveVariant(
      generateVariant(resolved.light as ThemeVariant, "dark"),
      "dark",
    );
    warnings.push("dark: generated from the light variant");
  }
  if (!resolved.light) {
    resolved.light = resolveVariant(
      generateVariant(resolved.dark, "light"),
      "light",
    );
    warnings.push("light: generated from the dark variant");
  }

  return {
    id: slugify(name),
    name,
    ...(typeof json.author === "string" && json.author.trim()
      ? { author: json.author.trim() }
      : {}),
    dark: resolved.dark,
    light: resolved.light as ThemeVariant,
    generated,
    warnings,
  };
};
