import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guard for the first-launch config.toml (DEFAULT_CONFIG in vaultdraw-core) against the
 * generated schema (docs/config.schema.json, which docs/configuration.md is built from):
 * every documented key is in the template, and every key the template shows is documented.
 * Catches the native-only keys (control.*, network.*, backup.*) the mapping-based tests miss.
 */
const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

interface SchemaNode {
  properties?: Record<string, SchemaNode>;
}

const schema = JSON.parse(read("docs/config.schema.json")) as SchemaNode;

/** Tables whose children are user data (ids, command names), not fixed keys. */
const OPEN = new Set(["hotkeys", "plugin", "include", "commands", "tools"]);

const templateText = () => {
  const rs = read(
    "excalidraw-desktop/src-tauri/crates/vaultdraw-core/src/config.rs",
  );
  const body = rs
    .slice(rs.indexOf('pub const DEFAULT_CONFIG: &str = r##"'))
    .split('r##"')[1];
  return body.slice(0, body.indexOf('"##;'));
};

/** `table.key` for every key line (`key = ` or `# key = `) under a plain `[table]` header. */
const templateKeys = (text: string) => {
  const keys = new Set<string>();
  let table: string | null = null;
  for (const line of text.split("\n")) {
    const header = /^\[([A-Za-z0-9_.-]+)\]\s*$/.exec(line);
    if (header) {
      table = header[1];
      continue;
    }
    // A commented sub-table header, like `# [keys.labels]`, shows that nested key.
    const sub = /^# \[([a-z]+)\.([a-z]+)\]\s*$/.exec(line);
    if (sub) {
      keys.add(`${sub[1]}.${sub[2]}`);
    }
    // A key line starts a TOML value; prose such as "# false = ignore ..." does not.
    const key =
      /^(?:# )?([a-z][a-z0-9_-]*) = (?:["\[{\d-]|true\b|false\b)/.exec(line);
    if (table && key && key[1] !== "true" && key[1] !== "false") {
      keys.add(`${table}.${key[1]}`);
    }
  }
  return keys;
};

const schemaKeys = () => {
  const keys = new Set<string>();
  for (const [table, node] of Object.entries(schema.properties ?? {})) {
    if (OPEN.has(table)) {
      continue;
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      if (!child.properties) {
        keys.add(`${table}.${key}`);
      }
    }
  }
  return keys;
};

describe("first-launch config.toml vs the documented keys", () => {
  const shown = templateKeys(templateText());
  const documented = schemaKeys();

  it("shows every documented key", () => {
    expect([...documented].filter((k) => !shown.has(k)).sort()).toEqual([]);
  });

  it("shows no key that is not documented", () => {
    const tables = new Set([...documented].map((k) => k.split(".")[0]));
    const extra = [...shown]
      .filter((k) => tables.has(k.split(".")[0]) && !documented.has(k))
      .sort();
    expect(extra).toEqual([]);
  });

  it("shows the [tools.<tool>] example", () => {
    expect(templateText()).toMatch(/^# \[tools\.arrow\]$/m);
  });
});
