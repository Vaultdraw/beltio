/**
 * Parity with the CLI. `vaultdraw new` (app closed) builds the same first
 * scene in Rust (vaultdraw-core new_drawing.rs); both read the golden file
 * `new-drawing-parity.json`. After an intended change, regenerate it with
 * `UPDATE_PARITY=1 npx vitest run src/tests/newDrawingPaper.test.ts`, and
 * make the Rust side pass `cargo test -p vaultdraw-core new_drawing`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { newDrawingPaper } from "../vault/newDrawingPaper";
import { DEFAULT_PREFERENCES } from "../vault/preferences";
import { configToPreferences } from "../vault/settingsSync";
import { parseVaultSettings, resolveSetting } from "../vault/vaultSettings";

type Case = {
  name: string;
  config: Record<string, unknown>;
  vault: Record<string, unknown>;
  expected?: unknown;
};

const GOLDEN = resolve(
  __dirname,
  "../../src-tauri/crates/vaultdraw-core/tests/fixtures/new-drawing-parity.json",
);

const run = (c: Pick<Case, "config" | "vault">) => {
  const prefs = {
    ...DEFAULT_PREFERENCES,
    ...configToPreferences(c.config).values,
  };
  const overrides = parseVaultSettings(c.vault).overrides;
  return JSON.parse(
    JSON.stringify(
      newDrawingPaper(
        prefs,
        resolveSetting("paperStyle", overrides, prefs),
        "#ffffff",
      ),
    ),
  );
};

const paper = (t: Record<string, unknown>) => ({ paper: t });
const page = (t: Record<string, unknown>) => ({ page: t });
const both = (a: Record<string, unknown>, b: Record<string, unknown>) => ({
  paper: a,
  page: b,
});
const PAGE = { mode: "page" };

const INPUTS: Case[] = [
  { name: "defaults", config: {}, vault: {} },
  {
    name: "canvas background",
    config: { appearance: { canvas_background: "#121212" } },
    vault: {},
  },
  {
    name: "invalid canvas background",
    config: { appearance: { canvas_background: "not a colour!" } },
    vault: {},
  },
  ...["grid", "lines", "dots", "graph", "isometric"].map((style) => ({
    name: `paper ${style} preset`,
    config: paper({ style }),
    vault: {},
  })),
  {
    name: "paper tuned",
    config: paper({
      style: "graph",
      spacing: 24,
      color: "#AABBCC",
      opacity: 0.4,
      major_every: 10,
      margin_line: false,
    }),
    vault: {},
  },
  {
    name: "paper invalid values fall back one by one",
    config: paper({
      style: "dots",
      spacing: 3,
      color: "red",
      opacity: 5,
      major_every: 2.5,
    }),
    vault: {},
  },
  { name: "paper unknown style", config: paper({ style: "wavy" }), vault: {} },
  {
    name: "vault style differs: preset spacing",
    config: paper({ style: "grid", spacing: 40, major_every: 8 }),
    vault: paper({ style: "dots" }),
  },
  {
    name: "vault style same: keeps tuning",
    config: paper({ style: "grid", spacing: 40, major_every: 8 }),
    vault: paper({ style: "grid" }),
  },
  {
    name: "vault plain",
    config: paper({ style: "grid" }),
    vault: paper({ style: "plain" }),
  },
  {
    name: "vault invalid style ignored",
    config: paper({ style: "grid" }),
    vault: paper({ style: "bogus" }),
  },
  {
    name: "page normal mode",
    config: page({ mode: "normal", size: "a3" }),
    vault: {},
  },
  { name: "page default setup", config: page(PAGE), vault: {} },
  {
    name: "page letter landscape continuous",
    config: page({
      ...PAGE,
      size: "letter",
      orientation: "landscape",
      layout: "continuous",
    }),
    vault: {},
  },
  ...["a3", "a4", "a5", "b5", "legal", "tablet", "tabletLarge", "phone"].map(
    (size) => ({
      name: `page size ${size}`,
      config: page({ ...PAGE, size }),
      vault: {},
    }),
  ),
  {
    name: "page custom size",
    config: page({ ...PAGE, size: "custom", width: 600, height: 900 }),
    vault: {},
  },
  {
    name: "page custom size, one side unset",
    config: page({ ...PAGE, size: "custom", width: 600 }),
    vault: {},
  },
  {
    name: "page custom size, invalid side",
    config: page({ ...PAGE, size: "custom", width: 50 }),
    vault: {},
  },
  {
    name: "page old school on plain",
    config: page({ ...PAGE, paper_theme: "old_school" }),
    vault: {},
  },
  {
    name: "page old school recolours a pattern",
    config: both(
      { style: "dots", color: "#112233" },
      { ...PAGE, paper_theme: "old_school" },
    ),
    vault: {},
  },
  {
    name: "page normal theme resets colours",
    config: {
      appearance: { canvas_background: "#222222" },
      ...both(
        { style: "grid", color: "#112233" },
        { ...PAGE, paper_theme: "normal" },
      ),
    },
    vault: {},
  },
  {
    name: "page match theme resets colours",
    config: both(
      { style: "lines", color: "#112233" },
      { ...PAGE, paper_theme: "match" },
    ),
    vault: {},
  },
  {
    name: "page with a vault style",
    config: both({ style: "grid" }, PAGE),
    vault: paper({ style: "lines" }),
  },
];

describe("new drawing paper: parity with the CLI", () => {
  if (process.env.UPDATE_PARITY) {
    it("regenerates the golden file", () => {
      const cases = INPUTS.map((c) => ({ ...c, expected: run(c) }));
      writeFileSync(
        GOLDEN,
        `${JSON.stringify(
          {
            note: "Shared by newDrawingPaper.test.ts and vaultdraw-core new_drawing.rs. Regenerate: UPDATE_PARITY=1 vitest run src/tests/newDrawingPaper.test.ts",
            cases,
          },
          null,
          2,
        )}\n`,
      );
    });
    return;
  }

  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as { cases: Case[] };

  it("the golden file lists every case of this test", () => {
    expect(golden.cases.map((c) => c.name)).toEqual(INPUTS.map((c) => c.name));
    expect(
      golden.cases.map(({ config, vault }) => ({ config, vault })),
    ).toEqual(INPUTS.map(({ config, vault }) => ({ config, vault })));
  });

  it.each(golden.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(run(c)).toEqual(c.expected);
  });
});
