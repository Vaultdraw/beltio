/**
 * Design-token guards (toimprove #74): the shell CSS must only use tokens that
 * exist, so a missing one (like `--vault-accent` before this test) can't
 * silently render as nothing again.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { ROW_HEIGHT as TAG_ROW_HEIGHT } from "../components/tags/TagsPanel";
import { TREE_ROW_HEIGHT } from "../components/tree/useTreeWindow";
import { deriveTokens, loadBuiltinThemes } from "../theme";

import COLOUR_BASELINE from "./literalColours.baseline.json";

const ROOT = join(__dirname, "..", "..");
const SCAN = [join(ROOT, "src"), join(ROOT, "..", "plugins", "official")];
const SKIP = /node_modules|dist|\.test\.|__snapshots__/;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (SKIP.test(path)) {
      continue;
    }
    if (statSync(path).isDirectory()) {
      walk(path, out);
    } else if (/\.(css|tsx?)$/.test(name)) {
      out.push(path);
    }
  }
  return out;
};

const FILES = SCAN.flatMap((d) => walk(d)).map((path) => ({
  path,
  rel: relative(ROOT, path),
  text: readFileSync(path, "utf8"),
}));

export const cssFiles = () => FILES.filter((f) => f.path.endsWith(".css"));

const definedTokens = () => {
  const defined = new Set<string>();
  for (const { text } of FILES) {
    // CSS declarations `--vault-x:` and TS keys / setProperty("--vault-x", …).
    for (const m of text.matchAll(
      /(--vault-[a-z0-9-]+)\s*:|["'`](--vault-[a-z0-9-]+)["'`]/g,
    )) {
      defined.add(m[1] ?? m[2]);
    }
  }
  return defined;
};

describe("design token guards", () => {
  it("every var(--vault-…) used in the shell and official plugins is defined", () => {
    const defined = definedTokens();
    const missing: string[] = [];
    for (const { rel, text } of FILES) {
      for (const m of text.matchAll(/var\(\s*(--vault-[a-z0-9-]+)/g)) {
        if (!defined.has(m[1])) {
          missing.push(`${rel}: ${m[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("--vault-accent is computed for every built-in theme, light and dark", async () => {
    const themes = await loadBuiltinThemes();
    expect(themes.length).toBeGreaterThan(0);
    for (const theme of themes) {
      for (const mode of ["light", "dark"] as const) {
        const tokens = deriveTokens(theme[mode], mode) as Record<
          string,
          string
        >;
        expect(tokens["--vault-accent"], `${theme.id} ${mode}`).toBe(
          tokens["--vault-primary"],
        );
      }
    }
  });

  it("focus is drawn only with --vault-ring / --vault-ring-inset", () => {
    const bad: string[] = [];
    for (const { rel, text } of cssFiles()) {
      if (rel.endsWith("theme/designSystem.css")) {
        continue;
      }
      for (const m of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        const [, selector, body] = m;
        if (/outline:\s*[0-9.]+px/.test(body)) {
          bad.push(`${rel}: literal outline in ${selector.trim()}`);
        }
        if (
          /:focus/.test(selector) &&
          /box-shadow:[^;]*[0-9.]+px[^;]*var\(--vault-primary/.test(body)
        ) {
          bad.push(`${rel}: hand-made focus shadow in ${selector.trim()}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("sidebar lists share one row height (--vd-row) and one 16 px indent", () => {
    const css = (rel: string) =>
      FILES.find((f) => f.rel.endsWith(rel))?.text ?? "";
    const row = Number(
      /--vd-row:\s*(\d+)px/.exec(css("theme/designSystem.css"))?.[1],
    );
    expect(row).toBe(26);
    expect(TREE_ROW_HEIGHT).toBe(row);
    expect(TAG_ROW_HEIGHT).toBe(row);
    const rules: [string, string][] = [
      ["components/VaultShell.css", ".vault-tree-item {"],
      ["components/VaultShell.css", ".vault-menu__item {"],
      ["components/tags/TagsPanel.css", ".vault-tags__row {"],
      ["tabs/TabStrip.css", ".vault-tablist__row {"],
      ["components/QuickSwitcher.css", ".vault-quick__row {"],
    ];
    for (const [file, selector] of rules) {
      const text = css(file);
      const start = text.indexOf(`\n${selector}`);
      expect(start, `${file} ${selector}`).toBeGreaterThan(-1);
      const body = text.slice(start, text.indexOf("}", start));
      expect(body, `${file} ${selector}`).toMatch(/height:\s*var\(--vd-row\)/);
    }
    for (const m of FILES.flatMap((f) =>
      [...f.text.matchAll(/depth[^;\n]*\*\s*(\d+)(px)?/g)].map((x) => ({
        rel: f.rel,
        step: x[1],
      })),
    ).filter((x) => /tags|VaultShell|MoveModal/.test(x.rel))) {
      expect(m.step, m.rel).toBe("16");
    }
  });

  it("font sizes in the shell CSS come from the type scale (--vd-fs-*)", () => {
    const bad: string[] = [];
    for (const { rel, text } of cssFiles()) {
      if (!rel.startsWith("src/") || rel.endsWith("theme/designSystem.css")) {
        continue;
      }
      // em stays allowed: notes headings scale with the user's note font.
      for (const m of text.matchAll(/font-size:\s*[0-9.]+(px|rem)\b/g)) {
        bad.push(`${rel}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("literal colours outside theme/ never grow (ratchet; lower the baseline when you remove some)", () => {
    const counts: Record<string, number> = {};
    for (const { rel, text } of cssFiles()) {
      if (!rel.startsWith("src/") || rel.startsWith("src/theme/")) {
        continue;
      }
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/var\([^()]*(\([^()]*\)[^()]*)*\)/g, "");
      const n = (code.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g) ?? [])
        .length;
      if (n) {
        counts[rel.slice("src/".length)] = n;
      }
    }
    const grown = Object.entries(counts).filter(
      ([file, n]) =>
        n > ((COLOUR_BASELINE as Record<string, number>)[file] ?? 0),
    );
    expect(grown).toEqual([]);
  });

  it("floating layers use the z-index scale; toasts sit above menus, dialogs above both", () => {
    const ds = FILES.find((f) =>
      f.rel.endsWith("theme/designSystem.css"),
    )!.text;
    const z = (name: string) =>
      Number(new RegExp(`--z-${name}:\\s*(\\d+)`).exec(ds)?.[1]);
    expect(z("popover")).toBeGreaterThan(z("panel"));
    expect(z("toast")).toBeGreaterThan(z("popover"));
    expect(z("modal")).toBeGreaterThan(z("toast"));
    expect(z("drag")).toBeGreaterThan(z("modal"));
    const bad: string[] = [];
    for (const { rel, text } of cssFiles()) {
      if (!rel.startsWith("src/")) {
        continue; // official plugins stack inside the canvas
      }
      for (const m of text.matchAll(/z-index:\s*(-?\d+)\s*;/g)) {
        // 0-10 is local stacking inside one component.
        if (Number(m[1]) > 10) {
          bad.push(`${rel}: z-index ${m[1]}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("reduced motion is handled once, globally, and no rule animates 'all'", () => {
    const ds = FILES.find((f) =>
      f.rel.endsWith("theme/designSystem.css"),
    )!.text;
    expect(ds).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*\*,\s*::before,\s*::after\s*\{[^}]*transition: none !important[^}]*animation: none !important/,
    );
    const bad = cssFiles()
      .filter((f) => /transition:\s*all\b/.test(f.text))
      .map((f) => f.rel);
    expect(bad).toEqual([]);
  });
});
