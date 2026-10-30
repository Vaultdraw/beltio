import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guard (validator, 2026-10-30, hunter H-2, toimprove 197): text that is matched against what the
 * user types folds with ONE function, `search/foldKey.ts` (pinned to the native index by
 * `foldContract.test.ts`). 6f86b1ed moved tags and links to it and left the quick switcher's copy
 * (`commands/fuzzy.ts`: NFKD + strip marks only, so "lodz" misses "Łódź"); the same copy sits in
 * the graph plugin's filter. A new `normalize("NFKD")` fold outside foldKey.ts fails here.
 * KNOWN: today's copies with the reason; delete a line when it moves to foldKey.
 * Plugin source is read as text (it is outside the desktop type check).
 *
 * Second member (hunter H-5): a name filter that only lower-cases (`toLowerCase().includes`)
 * misses accents ("cafe" never finds the folder "Café"). Each file's count is pinned: a new one
 * fails here; use foldKey on both sides instead, or add the file with a reason.
 */
const ROOT = join(__dirname, "../..");
const DIRS = [join(ROOT, "src"), join(ROOT, "../plugins/official")];
const ALLOWED: Record<string, string> = {
  "src/search/foldKey.ts": "the one fold",
  "src/theme/normalize.ts": "theme ids, not user search",
};
const KNOWN: Record<string, string> = {
  "../plugins/official/graph/src/filters.ts":
    "toimprove 197 family (graph filter)",
};

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!["node_modules", "dist", "tests", "e2e"].includes(name)) {
        walk(p, out);
      }
    } else if (
      /\.(ts|tsx)$/.test(name) &&
      !/\.(test|spec|bench)\.tsx?$/.test(name)
    ) {
      out.push(p);
    }
  }
  return out;
};

describe("guard: one fold for user-typed matching", () => {
  const found = DIRS.flatMap((d) => walk(d))
    .filter((f) =>
      /normalize\(\s*["'`]NFKD["'`]\s*\)/.test(readFileSync(f, "utf8")),
    )
    .map((f) => relative(ROOT, f).split("\\").join("/"));

  it("no new NFKD fold outside foldKey.ts", () => {
    expect(found.filter((f) => !ALLOWED[f] && !KNOWN[f])).toEqual([]);
  });
  it("KNOWN lists only copies that still exist (delete fixed ones)", () => {
    expect(Object.keys(KNOWN).filter((f) => !found.includes(f))).toEqual([]);
  });
  it.fails("no copies left (the switcher and graph filter use foldKey)", () => {
    expect(found.filter((f) => KNOWN[f])).toEqual([]);
  });
});

const LOWER_MATCH = /toLowerCase\(\)\.(?:includes|startsWith|indexOf)\(/g;
// Files allowed to match by lower case only, with why; counts are today's.
const LOWER_OK: Record<string, { count: number; why: string }> = {
  "src/components/ThemeInstallDialog.tsx": {
    count: 1,
    why: "theme names from a repo (ASCII ids)",
  },
  "src/components/menu/menuModel.ts": {
    count: 1,
    why: "menu type-ahead on English labels",
  },
  "src/smoke/explorerExportSmoke.ts": {
    count: 1,
    why: "smoke test, hex colours",
  },
  "src/theme/catalogue/search.ts": { count: 3, why: "theme catalogue text" },
  "src/vault/syncNames.ts": { count: 1, why: "a fixed English marker" },
};
const LOWER_KNOWN: Record<string, { count: number; why: string }> = {
  "src/components/tags/RenameTagDialog.tsx": {
    count: 1,
    why: "toimprove 201 family (tag picker)",
  },
};

describe("guard: name filters fold accents", () => {
  const counts: Record<string, number> = {};
  for (const f of walk(join(ROOT, "src"))) {
    const n = readFileSync(f, "utf8").match(LOWER_MATCH)?.length ?? 0;
    if (n) {
      counts[relative(ROOT, f).split("\\").join("/")] = n;
    }
  }
  it("no new lower-case-only name filter", () => {
    const extra = Object.entries(counts).filter(
      ([f, n]) => n > (LOWER_OK[f]?.count ?? LOWER_KNOWN[f]?.count ?? 0),
    );
    expect(extra).toEqual([]);
  });
  it.fails(
    "the vault-name and tag filters fold accents (KNOWN is empty)",
    () => {
      expect(Object.keys(LOWER_KNOWN).filter((f) => counts[f])).toEqual([]);
    },
  );
});

/**
 * Third and fourth members (validator, 2026-10-30 evening, V-4 / toimprove 214): a second copy of
 * foldKey's letter table (`.replace(/ß/…)`, æ, œ, ø, ł, đ, ı) drifts from the index; and foldKey
 * applied one character at a time never composes a decomposed name (Korean jamo, "か" + U+3099),
 * so Cmd+P missed names the vault search finds. Fold whole strings or grapheme clusters only.
 */
const ALL_DIRS = [...DIRS, join(ROOT, "../sdk")];
const TABLE_COPY = /\.replace\(\s*\/[ßæœøłđı]/;
const PIECEWISE = /\b(?:fold|foldKey)\(\s*(?:ch|c|char)\s*\)/;
const PIECEWISE_KNOWN: Record<string, string> = {
  "src/commands/fuzzy.ts": "toimprove 214 (Cmd+P folds per code unit)",
};

describe("guard: one fold table, applied to whole names", () => {
  const files = ALL_DIRS.flatMap((d) => walk(d)).map((f) => ({
    rel: relative(ROOT, f).split("\\").join("/"),
    text: readFileSync(f, "utf8"),
  }));
  it("no copy of foldKey's letter table outside foldKey.ts", () => {
    expect(
      files
        .filter((f) => f.rel !== "src/search/foldKey.ts")
        .filter((f) => TABLE_COPY.test(f.text))
        .map((f) => f.rel),
    ).toEqual([]);
  });
  const piecewise = files
    .filter((f) => PIECEWISE.test(f.text))
    .map((f) => f.rel);
  it("no new per-character fold", () => {
    expect(piecewise.filter((f) => !PIECEWISE_KNOWN[f])).toEqual([]);
  });
  it.fails(
    "no per-character fold left (empty PIECEWISE_KNOWN with 214)",
    () => {
      expect(piecewise).toEqual([]);
    },
  );
});
