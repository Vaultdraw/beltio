/**
 * Guard for the word list in STRINGS.md: scans the text people read in the UI
 * (setting labels and descriptions, JSX text, title / aria-label / placeholder
 * attributes, toast and error messages) for the mistakes the design review found.
 * Code, comments, command ids and key bindings are not scanned.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { SETTINGS_SCHEMA } from "../components/settings/schema";

const ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = [
  "excalidraw-desktop/src/components",
  "excalidraw-desktop/src/notes",
  "excalidraw-desktop/src/history",
  "excalidraw-desktop/src/templates",
  "excalidraw-desktop/src/help",
  "plugins/official",
];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules" || name === "test" || name === "dist") {
      return [];
    }
    if (statSync(p).isDirectory()) {
      return walk(p);
    }
    return /\.tsx?$/.test(name) && !/\.test\.|\.d\.ts$/.test(name) ? [p] : [];
  });

/** User-visible text in one source file: JSX text and the attributes and keys that reach the screen. */
const userText = (src: string): string[] => {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  const attr =
    /\b(?:title|aria-label|placeholder|label|message|description|confirmLabel|hint)(?:=|:\s*)\s*(?:\{\s*)?(["`])((?:(?!\1)[^\\]|\\.)*)\1/g;
  for (const m of code.matchAll(attr)) {
    out.push(m[2]);
  }
  // JSX text between tags: a capital letter, words, no code characters.
  for (const m of code.matchAll(/>\s*([A-Z][^<>{}=;]{3,}?)\s*</g)) {
    out.push(m[1]);
  }
  return out;
};

const RULES: Array<[string, RegExp]> = [
  ["typed key notation (render the live binding)", /\bMod\+/],
  [
    "config file names, sections or keys",
    /config\.toml|overrides\.toml|settings\.toml|\[(backup|hotkeys|extensions|plugins|links|tags|appearance|memory|network|favourites)\]|plugins\.[a-z]+/,
  ],
  ["backticks in user text", /`[^`$]+`/],
  ["three dots (use …)", /[A-Za-z]\.\.\.(?!\w)/],
  ['"&" in user text (write "and")', /\s&\s/],
  ['"(s)" plurals', /\w\(s\)/],
  ["American spelling (Colour)", /\bColor\b|\bcolor\b(?!-)/],
];

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
const strings = files.flatMap((f) =>
  userText(readFileSync(f, "utf8")).map((text) => ({
    file: relative(ROOT, f),
    text,
  })),
);

describe("user strings follow STRINGS.md", () => {
  it("found strings to check", () => {
    expect(strings.length).toBeGreaterThan(500);
  });

  it.each(RULES)("no %s", (_name, pattern) => {
    const bad = strings
      .filter((s) => pattern.test(s.text))
      .map((s) => `${s.file}: ${s.text}`);
    expect(bad).toEqual([]);
  });

  const PROPER = new Set([
    "PDF",
    "PNG",
    "SVG",
    "JPEG",
    "URL",
    "Vaultdraw",
    "Excalidraw",
    "Obsidian",
    "Markdown",
    "Trash",
    "Vim",
    "GitHub",
  ]);

  it("setting labels use sentence case", () => {
    const bad = SETTINGS_SCHEMA.flatMap((s) => {
      const words = s.label.split(/\s+/).slice(1);
      return words.some((w) => /^[A-Z][a-z]/.test(w) && !PROPER.has(w))
        ? [s.label]
        : [];
    });
    expect(bad).toEqual([]);
  });
});
