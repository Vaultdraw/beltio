#!/usr/bin/env node
/**
 * Writes sdk/docs/manifest.md from sdk/api/plugin.schema.json. Plain node, no dependencies.
 * Run: node sdk/api/scripts/gen-manifest-docs.mjs
 * The test sdk/api/test/manifestDocs.test.ts fails when the committed file differs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_FILE = path.join(here, "..", "plugin.schema.json");
export const DOC_FILE = path.join(here, "..", "..", "docs", "manifest.md");

/** A complete, valid manifest. The test validates it against the schema. */
export const EXAMPLE = `id = "hello-command"
name = "Hello"
version = "0.1.0"
api = 0
min_app = "0.1.0"
main = "main.js"
description = "Says hello"
author = "you"
activation = []
dev = false

[[contributes.commands]]
id = "hello"
title = "Hello: say hello"
keys = ["Mod+Alt+H"]
when = ["vaultOpen"]
palette = true

[[contributes.panels]]
id = "notes"
title = "Notes"
icon = "note"
group = "top"

[[contributes.settings]]
key = "greeting"
type = "string"
title = "Greeting"
default = "Hello"
`;

const PRINT_WIDTH = 80;

/** A Markdown table laid out the way Prettier 2 does: aligned if it fits in 80 columns, else compact. */
function table(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, i) =>
    Math.max(3, ...all.map((r) => [...r[i]].length)),
  );
  const line = (cells, pad) =>
    `| ${cells.map((c, i) => (pad ? c.padEnd(widths[i]) : c)).join(" | ")} |`;
  const rule = (pad) =>
    `| ${widths.map((w) => (pad ? "-".repeat(w) : "---")).join(" | ")} |`;
  const aligned = [
    line(header, true),
    rule(true),
    ...rows.map((r) => line(r, true)),
  ];
  if (aligned.every((l) => [...l].length <= PRINT_WIDTH)) {
    return aligned.join("\n");
  }
  return [
    line(header, false),
    rule(false),
    ...rows.map((r) => line(r, false)),
  ].join("\n");
}

const cell = (s) => s.replaceAll("|", "\\|").replaceAll("\n", " ");
const code = (s) => `\`${cell(String(s))}\``;

function typeOf(p) {
  if ("const" in p) {
    return code(JSON.stringify(p.const));
  }
  if (p.enum) {
    return "one of";
  }
  const base = Array.isArray(p.type) ? p.type.join(" or ") : p.type;
  if (p.type === "array" && p.items) {
    const it = p.items.enum ? "string" : p.items.type;
    return `list of ${it === "object" ? "tables" : `${it}s`}`;
  }
  return base === "object" ? "table" : base;
}

function limits(p) {
  const out = [];
  if (p.enum) {
    out.push(p.enum.map((v) => code(JSON.stringify(v))).join(", "));
  } else if (p.items?.enum) {
    out.push(
      `items: ${p.items.enum.map((v) => code(JSON.stringify(v))).join(", ")}`,
    );
  }
  if (p.pattern === "\\S") {
    out.push("not blank");
  } else if (p.pattern?.startsWith("^(0|[1-9]")) {
    out.push("semantic version");
  } else if (p.pattern?.length > 70) {
    out.push("path rules in the description");
  } else if (p.pattern) {
    out.push(code(p.pattern));
  }
  if (p.maxLength !== undefined) {
    out.push(`${p.minLength ?? 0} to ${p.maxLength} chars`);
  } else if (p.minLength !== undefined) {
    out.push(`at least ${p.minLength} char`);
  }
  if (p.maxItems !== undefined) {
    out.push(`at most ${p.maxItems}`);
  }
  return out.join("; ") || "";
}

function section(props, required) {
  const rows = Object.entries(props).map(([key, p]) => [
    code(key),
    typeOf(p),
    required.includes(key) ? "yes" : "no",
    "default" in p ? code(JSON.stringify(p.default)) : "",
    limits(p),
    cell(p.description),
  ]);
  return table(
    ["Key", "Type", "Required", "Default", "Limits", "Description"],
    rows,
  );
}

export function generate(
  schema = JSON.parse(fs.readFileSync(SCHEMA_FILE, "utf8")),
) {
  const c = schema.properties.contributes.properties;
  const defs = schema.definitions;
  const topProps = Object.fromEntries(
    Object.entries(schema.properties).filter(([k]) => k !== "contributes"),
  );
  const parts = [
    "<!-- Generated from plugin.schema.json by sdk/api/scripts/gen-manifest-docs.mjs. Do not edit. -->",
    "",
    "# plugin.toml reference",
    "",
    "Every key of a plugin manifest, with its limits. Generated from `sdk/api/plugin.schema.json`, the file editors read for completion and hover help.",
    "",
    "## Example",
    "",
    "```toml",
    EXAMPLE.trimEnd(),
    "```",
    "",
    "## Editor completion",
    "",
    "Taplo (Even Better TOML in VS Code, and the Neovim and Helix language servers) reads a schema named on the first line of the file:",
    "",
    "```toml",
    "#:schema ./plugin.schema.json",
    "```",
    "",
    "The path is relative to the manifest. The `vaultdraw-plugin init` templates ship `plugin.schema.json` next to `plugin.toml`. Without that file, copy it from `sdk/api/plugin.schema.json`.",
    "",
    "## Top-level keys",
    "",
    section(topProps, schema.required),
    "",
    `Tables named ${code(
      "x-*",
    )} are free for tools and ignored by the app and the CLI. Any other unknown key is an error (\`unknown-key\`).`,
    "",
    "## `[[contributes.commands]]`",
    "",
    `${c.commands.description} ${defs.command.description}`,
    "",
    section(defs.command.properties, defs.command.required),
    "",
    "## `[[contributes.panels]]`",
    "",
    `${c.panels.description} ${defs.panel.description}`,
    "",
    section(defs.panel.properties, defs.panel.required),
    "",
    "## `[[contributes.settings]]`",
    "",
    `${c.settings.description} ${defs.setting.description}`,
    "",
    section(defs.setting.properties, defs.setting.required),
    "",
    "Each entry of `options` is an inline table:",
    "",
    section(
      defs.setting.properties.options.items.properties,
      defs.setting.properties.options.items.required,
    ),
    "",
    "## Rules that live in code",
    "",
    "A schema cannot express these. `vaultdraw-plugin check` and the app enforce them:",
    "",
    "- `plugin.toml` is at most 64 KB (`manifest-too-large`).",
    "- Command ids are unique within the plugin, and so are panel ids (`contribution-duplicate`).",
    "- The file named by `main` exists (`main-missing`).",
    "- A packaged manifest does not set `dev = true` (`dev-true`).",
    "- `min_app` is not lower than the first app version with the API the code uses (`min-app-low`, a warning).",
    "- The plugin id does not collide with another installed plugin.",
    "- A `select` setting's `default` is one of its `options`, and every `default` fits its `type`, `min` and `max`. The settings registry reports problems on the Plugins page.",
    "",
    "Every check code is listed in the [reference](reference.md#check-codes).",
    "",
  ];
  return parts.join("\n");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  fs.writeFileSync(DOC_FILE, generate());
  process.stdout.write(`wrote ${path.relative(process.cwd(), DOC_FILE)}\n`);
}
