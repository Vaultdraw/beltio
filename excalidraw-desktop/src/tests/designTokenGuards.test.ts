/**
 * Design-token guards (toimprove #74): the shell CSS must only use tokens that
 * exist, so a missing one (like `--vault-accent` before this test) can't
 * silently render as nothing again.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { deriveTokens, loadBuiltinThemes } from "../theme";

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
});
