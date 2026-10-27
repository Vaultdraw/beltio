/**
 * Test-only reader for the plugin.toml subset documented in PLUGIN-API.md.
 * The Rust validator stays the authority; this only turns an example's
 * manifest into the host's PluginInfo for vitest and the e2e harness, and
 * throws on anything outside the subset.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

// Not the test kit: the Vite/Playwright config loads this file (pluginServer),
// and the kit pulls in the whole editor, which breaks config bundling.
import { makePluginInfo } from "../../../excalidraw-desktop/src/plugins/host/fakeBackend";

import type { PluginInfo } from "../../../excalidraw-desktop/src/plugins/host/types";

type Value = string | number | boolean | string[];
type Table = Record<string, Value>;

const TOP_KEYS = new Set([
  "id",
  "name",
  "version",
  "api",
  "min_app",
  "main",
  "description",
  "author",
  "activation",
  "dev",
  "data_key",
]);
const ARRAYS = [
  "commands",
  "panels",
  "settings",
  "importers",
  "status_bar",
] as const;

/** Drop a trailing `# comment` that is not inside a basic string. */
const stripComment = (line: string): string => {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inString && c === "\\") {
      i++;
    } else if (c === '"') {
      inString = !inString;
    } else if (c === "#" && !inString) {
      return line.slice(0, i);
    }
  }
  return line;
};

const parseValue = (raw: string, where: string): Value => {
  const v = raw.trim();
  if (v === "true" || v === "false") {
    return v === "true";
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    return Number(v);
  }
  if (/^"(?:[^"\\]|\\.)*"$/.test(v)) {
    return JSON.parse(v);
  }
  if (/^\[.*\]$/.test(v)) {
    const items = JSON.parse(v.replace(/,\s*\]$/, "]"));
    if (items.every((i: unknown) => typeof i === "string")) {
      return items;
    }
  }
  throw new Error(`plugin.toml: unsupported value at ${where}: ${raw}`);
};

export function parseManifest(source: string, mainBytes = 0): PluginInfo {
  const top: Table = {};
  const arrays: Record<typeof ARRAYS[number], Table[]> = {
    commands: [],
    panels: [],
    settings: [],
    importers: [],
    status_bar: [],
  };
  let current: Table = top;
  let extra = false;
  source.split("\n").forEach((rawLine, n) => {
    const where = `line ${n + 1}`;
    const line = stripComment(rawLine).trim();
    if (!line) {
      return;
    }
    const header = /^\[\[contributes\.(\w+)\]\]$/.exec(line);
    if (header && (ARRAYS as readonly string[]).includes(header[1])) {
      current = {};
      extra = false;
      arrays[header[1] as typeof ARRAYS[number]].push(current);
    } else if (/^\[x-[\w-]+\]$/.test(line)) {
      extra = true;
    } else if (line.startsWith("[")) {
      throw new Error(`plugin.toml: unsupported table at ${where}: ${line}`);
    } else {
      const kv = /^([\w-]+)\s*=\s*(.+)$/.exec(line);
      if (!kv) {
        throw new Error(`plugin.toml: cannot parse ${where}: ${line}`);
      }
      if (extra) {
        return;
      }
      if (current === top && !TOP_KEYS.has(kv[1])) {
        throw new Error(`plugin.toml: unknown top-level key ${kv[1]}`);
      }
      current[kv[1]] = parseValue(kv[2], where);
    }
  });

  const str = (k: string) => (top[k] as string | undefined) ?? null;
  return makePluginInfo(top.id as string, {
    name: top.name as string,
    version: top.version as string,
    api: top.api as number,
    minApp: str("min_app"),
    main: top.main as string,
    description: str("description"),
    author: str("author"),
    source: "bundled",
    mainBytes,
    activation: (top.activation as string[] | undefined) ?? [],
    dataKey: str("data_key"),
    contributes: {
      commands: arrays.commands.map((c) => ({
        id: c.id as string,
        title: c.title as string,
        keys: (c.keys as string[] | undefined) ?? [],
        when: (c.when as string[] | undefined) ?? [],
        palette: (c.palette as boolean | undefined) ?? true,
      })),
      panels: arrays.panels.map((p) => ({
        id: p.id as string,
        title: p.title as string,
        icon: (p.icon as string | undefined) ?? null,
        group: (p.group as "top" | "bottom" | undefined) ?? "top",
      })),
      settings: arrays.settings as never,
      importers: arrays.importers.map((i) => ({
        id: i.id as string,
        title: i.title as string,
        extensions: i.extensions as string[],
      })),
      status_bar: arrays.status_bar.map((x) => ({
        id: x.id as string,
        title: x.title as string,
        align: (x.align as "left" | "right" | undefined) ?? "right",
        priority: (x.priority as number | undefined) ?? 0,
        command: (x.command as string | undefined) ?? null,
      })),
    },
  });
}

export const EXAMPLES_DIR = path.resolve(__dirname, "..");

/** Read `sdk/examples/<id>/plugin.toml` into a PluginInfo (mainBytes = main.js size). */
export function readExample(id: string): PluginInfo {
  return readPluginDir(path.join(EXAMPLES_DIR, id));
}

/** Read the plugin folder `dir` (plugin.toml and its main file) into a PluginInfo. */
export function readPluginDir(dir: string): PluginInfo {
  const info = parseManifest(
    readFileSync(path.join(dir, "plugin.toml"), "utf8"),
  );
  const mainBytes = statSync(path.join(dir, info.main)).size;
  return { ...info, mainBytes, dir };
}
