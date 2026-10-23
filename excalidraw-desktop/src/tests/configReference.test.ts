import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BEGIN_MARKER,
  CONFIG_REFERENCE,
  END_MARKER,
  referenceGaps,
  spliceReference,
} from "../vault/configReference";
import { currentReference } from "../vault/configReferenceDoc";
import { OPEN_TABLES } from "../vault/configKeys";
import { CONFIG_MAPPING } from "../vault/settingsSync";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/** The first-launch config.toml text (DEFAULT_CONFIG in vaultdraw-core). */
const defaultConfig = () => {
  const rs = read(
    "excalidraw-desktop/src-tauri/crates/vaultdraw-core/src/config.rs",
  );
  const start = rs.indexOf('pub const DEFAULT_CONFIG: &str = r##"');
  const body = rs.slice(start).split('r##"')[1];
  return body.slice(0, body.indexOf('"##;'));
};

/** `[table]` -> its lines, for the top-level tables of a TOML text. */
const sections = (text: string) => {
  const out = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of text.split("\n")) {
    const header = /^\[([A-Za-z0-9_-]+)\]\s*$/.exec(line);
    if (header) {
      current = [];
      out.set(header[1], current);
    } else {
      current?.push(line);
    }
  }
  return out;
};

describe("config reference", () => {
  it("documents every key the app reads, and nothing else", () => {
    expect(referenceGaps({ mappings: CONFIG_MAPPING })).toEqual({
      undocumented: [],
      unknown: [],
    });
  });

  it("docs/configuration.md is up to date (run yarn docs:config)", () => {
    const doc = read("docs/configuration.md");
    expect(doc).toContain(BEGIN_MARKER);
    expect(doc).toContain(END_MARKER);
    expect(spliceReference(doc, currentReference())).toBe(doc);
  });

  it("lists every key with its default and accepted values", () => {
    const block = currentReference();
    for (const { key } of CONFIG_MAPPING) {
      const [table, name] = key.split(".");
      expect(block).toContain(`### \`[${table}]\``);
      expect(block).toContain(`| \`${name}\` |`);
    }
    expect(block).toMatch(/\| `undo_budget_mb` \| `32` \|/);
    expect(block).toMatch(/\| `pane_sort` \| `"name"` \|/);
  });

  it("the first-launch config.toml shows every key in its table", () => {
    const tables = sections(defaultConfig());
    const missing: string[] = [];
    for (const { key } of CONFIG_MAPPING) {
      const [table, name] = key.split(".");
      const lines = tables.get(table);
      const shown =
        lines &&
        (table === "tools"
          ? lines.some((l) => l.startsWith("#") && l.includes(name))
          : lines.some((l) => new RegExp(`^(# )?${name} = `).test(l)));
      if (!shown) {
        missing.push(key);
      }
    }
    expect(missing).toEqual([]);
  });

  it("the first-launch config.toml has no unknown tables", () => {
    const known = new Set([
      ...CONFIG_REFERENCE.map((t) => t.table),
      ...OPEN_TABLES,
    ]);
    const unknown = [...sections(defaultConfig()).keys()].filter(
      (t) => !known.has(t),
    );
    expect(unknown).toEqual([]);
  });

  it("the first-launch config.toml has the [tags] block", () => {
    const tags = sections(defaultConfig()).get("tags") ?? [];
    expect(tags).toContain("# autocomplete = true");
    expect(tags).toContain('# pane_sort = "name"');
  });

  it("splicing needs both markers", () => {
    expect(() => spliceReference("no markers", "x")).toThrow(/markers/);
  });
});
