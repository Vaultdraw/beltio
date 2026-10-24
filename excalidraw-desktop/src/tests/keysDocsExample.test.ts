/**
 * The Vim-style example in docs/configuration.md and the copyable preset
 * docs/presets/vim.toml must parse with the
 * production parsers, use only real command ids and raise no key conflicts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { allCommands, getCommand } from "../commands/commands";
import { findConflicts } from "../commands/conflicts";
import { configToPreferences } from "../vault/settingsSync";

const DOC = resolve(__dirname, "../../../docs/configuration.md");
const PRESET = resolve(__dirname, "../../../docs/presets/vim.toml");

const exampleBlock = (): string => {
  const doc = readFileSync(DOC, "utf8");
  const match =
    /<!-- keys-docs-example -->\s*```toml\n([\s\S]*?)```\s*<!-- \/keys-docs-example -->/.exec(
      doc,
    );
  if (!match) {
    throw new Error(
      "keys-docs-example block not found in docs/configuration.md",
    );
  }
  return match[1];
};

/** Drop a trailing comment that is outside double quotes. */
const stripComment = (line: string): string => {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inString = !inString;
    } else if (line[i] === "#" && !inString) {
      return line.slice(0, i);
    }
  }
  return line;
};

/**
 * Reads the TOML subset the example uses: [a.b] tables and `"key" = value`
 * lines whose values are JSON-compatible (strings, numbers, booleans, arrays).
 * The repo has no TOML library in its JS tests; the app parses in Rust.
 */
const parseExample = (text: string): Record<string, unknown> => {
  const root: Record<string, unknown> = {};
  let table = root;
  for (const raw of text.split("\n")) {
    const line = stripComment(raw).trim();
    if (!line) {
      continue;
    }
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      table = root;
      for (const part of header[1].split(".")) {
        table = (table[part] ??= {}) as Record<string, unknown>;
      }
      continue;
    }
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    const name = key.startsWith('"') ? JSON.parse(key) : key;
    table[name] = JSON.parse(line.slice(eq + 1).trim());
  }
  return root;
};

const SOURCES: ReadonlyArray<readonly [string, () => string]> = [
  ["docs/configuration.md Vim-style example", exampleBlock],
  ["docs/presets/vim.toml", () => readFileSync(PRESET, "utf8")],
];

describe.each(SOURCES)("%s", (_name, load) => {
  const config = parseExample(load());
  const { values, problems } = configToPreferences(config);

  it("parses with no problems", () => {
    expect(problems).toEqual([]);
  });

  it("keeps every binding and label", () => {
    expect(Object.keys(values.hotkeys).length).toBeGreaterThan(5);
    expect(values.hotkeys["list.first"]).toEqual(["G G", "Home"]);
    expect(values.hotkeys["palette.files"]).toContain("<leader> F F");
    expect(values.keysLabels["<leader> f"]).toBe("file");
  });

  it("uses only registered command ids", () => {
    for (const id of Object.keys(values.hotkeys)) {
      expect(getCommand(id), id).toBeDefined();
    }
  });

  it.each(["mac", "win"] as const)(
    "has no command or prefix conflicts on %s",
    (platform) => {
      const conflicts = findConflicts(
        allCommands(values.hotkeys),
        values.hotkeys,
        platform,
      );
      const clashes: string[] = [];
      for (const [id, perChord] of conflicts) {
        for (const [chord, found] of perChord) {
          for (const c of found) {
            if (c.kind === "command" || c.kind === "prefix") {
              clashes.push(`${id} ${chord}: ${c.kind} ${c.id}`);
            }
          }
        }
      }
      expect(clashes).toEqual([]);
    },
  );

  it("never uses Mod+K", () => {
    expect(load()).not.toMatch(/Mod\+K\b/);
  });
});

describe("docs/presets/vim.toml", () => {
  const { values } = configToPreferences(
    parseExample(readFileSync(PRESET, "utf8")),
  );

  it("covers lists, leader, tabs, links, graph and tool keys", () => {
    expect(values.hotkeys["list.first"]).toEqual(["G G", "Home"]);
    expect(values.hotkeys["list.delete"]?.[0]).toBe("D D");
    expect(values.hotkeys["palette.files"]).toContain("<leader> F F");
    const ids = Object.keys(values.hotkeys);
    for (const prefix of ["tabs.", "links.", "graph.", "tool.", "list."]) {
      expect(
        ids.some((id) => id.startsWith(prefix)),
        prefix,
      ).toBe(true);
    }
  });

  it("keeps the default keys it does not change", () => {
    expect(values.hotkeys["tool.rectangle"]).toContain("R");
    expect(values.hotkeys["file.save"]).toContain("Mod+S");
  });

  it("labels every leader group it uses", () => {
    const groups = new Set(
      Object.values(values.hotkeys)
        .flat()
        .filter((k) => k.startsWith("<leader> ") && k.split(" ").length > 2)
        .map((k) => k.split(" ").slice(0, 2).join(" ").toLowerCase()),
    );
    for (const g of groups) {
      expect(
        Object.keys(values.keysLabels).map((l) => l.toLowerCase()),
      ).toContain(g);
    }
  });
});
