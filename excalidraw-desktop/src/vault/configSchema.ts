/**
 * JSON Schema of config.toml, generated from the same key table as the
 * reference doc (CONFIG_MAPPING + CONFIG_REFERENCE + DEFAULT_PREFERENCES).
 * The type and limits of each key come from its `expected` text, which the
 * app builds from its own limit constants, plus a few explicit overrides
 * below; configSchema.test.ts checks every key's schema against its real
 * validator, so the schema can never be stricter than the app.
 *
 * Written to docs/config.schema.json by `yarn docs:config`. Editors (Taplo:
 * Even Better TOML, Zed, Neovim) read it for completion; vaultdraw-core
 * embeds it for `vaultdraw config check`. Only the generator and the tests
 * import this module.
 */
import { MAX_PEN_WIDTH, MIN_PEN_WIDTH } from "../pens/penPresets";

import { LAYOUT_PARTS } from "../layout/layoutSettings";

import { CONFIG_REFERENCE } from "./configReference";
import { OPEN_TABLES } from "./configKeys";

import type { ConfigMapping } from "./settingsSync";

export const SCHEMA_PATH = "docs/config.schema.json";

export type Schema = { [key: string]: unknown };

/**
 * Colour formats. `format` is read by vaultdraw-core (no regex engine there);
 * `pattern` is the same rule for editors.
 */
export const FORMATS = {
  color:
    "^(#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|transparent|[a-zA-Z]+)$",
  hex6: "^#[0-9a-fA-F]{6}$",
  hex3or6: "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$",
} as const;

const fmt = (format: keyof typeof FORMATS): Schema => ({
  type: "string",
  format,
  pattern: FORMATS[format],
});

const orConst = (value: unknown, rest: Schema): Schema => ({
  anyOf: [{ const: value }, rest],
});

const stringList: Schema = { type: "array", items: { type: "string" } };

/** Keys whose `expected` text cannot be read as a type, or reads too loosely. */
const OVERRIDES: Readonly<Record<string, Schema>> = {
  "network.allow_themes": { type: "boolean" },
  "themes.max_install_kb": { type: "integer", minimum: 1, maximum: 256 },
  "themes.index_url": {
    type: "string",
    pattern:
      "^(https://|http://(localhost|127\\.0\\.0\\.1|\\[::1\\])(:[0-9]+)?(/|$))[^ ]+$",
  },
  "appearance.theme": { type: "string", minLength: 1 },
  "appearance.accent_color": orConst("", fmt("hex3or6")),
  "paper.color": orConst("", fmt("hex6")),
  "links.color": orConst("accent", fmt("hex6")),
  "links.update_on_rename": { enum: [true, false, "ask"] },
  "links.hint_chars": { type: "string", minLength: 2 },
  "files.templates_folder": { type: "string", minLength: 1 },
  "editor.font_size": { type: "number", exclusiveMinimum: 0, maximum: 1000 },
  "editor.stroke_width": { type: "number", exclusiveMinimum: 0, maximum: 1000 },
  "keys.leader": { type: "string", minLength: 1 },
  // Extension -> plugin id ("" turns plugin handling off for it).
  "plugins.importers": {
    type: "object",
    additionalProperties: { type: "string" },
  },
  "layout.preset": { type: "string" },
  "layout.presets": {
    type: "object",
    additionalProperties: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        LAYOUT_PARTS.map((part) => [part, { type: "boolean" }]),
      ),
    },
  },
};

/** Strips `(notes)`, keeping a parenthesis that holds the whole list. */
const quoted = (text: string): string[] | null => {
  const bare = text.replace(/\s*\([^)]*\)/g, "").trim();
  const inner = /\(([^)]*)\)/.exec(text)?.[1] ?? "";
  for (const candidate of [bare, inner]) {
    const items = candidate.split(/,\s*|\s+or\s+/).filter(Boolean);
    if (items.length > 0 && items.every((i) => /^"[^"]*"$/.test(i))) {
      return items.map((i) => i.slice(1, -1));
    }
  }
  return null;
};

const numberList = (text: string): number[] | null => {
  const items = text
    .replace(/^one of\s+/, "")
    .split(/,\s*|\s+or\s+/)
    .filter(Boolean);
  return items.length > 1 && items.every((i) => /^-?\d+(\.\d+)?$/.test(i))
    ? items.map(Number)
    : null;
};

const RANGE_RE =
  /(an integer|a whole number|a number)\b.*?\b(?:between|from)\s+(-?[\d.]+)\s+(?:and|to)\s+(-?[\d.]+)/;

/** The schema an `expected` text describes, or null when it cannot be read. */
export function schemaFromExpected(
  expected: string,
  fallback: unknown,
): Schema | null {
  if (expected === "true or false") {
    return { type: "boolean" };
  }
  const strings = quoted(expected);
  if (strings) {
    return { type: "string", enum: strings };
  }
  const numbers = numberList(expected);
  if (numbers) {
    return { enum: numbers };
  }
  const range = RANGE_RE.exec(expected);
  if (range) {
    const schema: Schema = {
      type: range[1] === "a number" ? "number" : "integer",
      minimum: Number(range[2]),
      maximum: Number(range[3]),
    };
    return /^0 \([^)]*\) or /.test(expected) ? orConst(0, schema) : schema;
  }
  if (/colou?r/.test(expected)) {
    return fmt("color");
  }
  if (/^a list of/.test(expected)) {
    return stringList;
  }
  if (typeof fallback === "string") {
    return { type: "string" };
  }
  return null;
}

/** Inferred from the default when nothing else says more. */
const fromDefault = (value: unknown): Schema | null =>
  typeof value === "boolean"
    ? { type: "boolean" }
    : typeof value === "string"
    ? { type: "string" }
    : null;

// Same limits as `penPresetProblem`; extra fields are ignored by the app, so
// they are allowed here too (the schema is never stricter than the app).
const penPreset: Schema = {
  type: "object",
  required: ["name", "color", "width"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 40 },
    color: fmt("color"),
    width: { type: "number", minimum: MIN_PEN_WIDTH, maximum: MAX_PEN_WIDTH },
    opacity: { type: "number", minimum: 1, maximum: 100 },
    pressure: { type: "boolean" },
    smoothing: { type: "number", minimum: 0, maximum: 1 },
    highlighter: { type: "boolean" },
  },
};

export interface SchemaInput {
  mappings: readonly Pick<ConfigMapping, "key" | "field" | "expected">[];
  defaults: Readonly<Record<string, unknown>>;
  /** `tools.<tool>` -> its allowed keys. */
  toolKeys: Readonly<Record<string, readonly string[]>>;
  /** Tool style key -> its `expected` text. */
  styleRules: Readonly<Record<string, { expected: string }>>;
  /** Most pen presets a config can hold. */
  maxPens: number;
}

/** One key's schema (without its description and default). */
export function keySchema(
  mapping: SchemaInput["mappings"][number],
  input: SchemaInput,
): Schema {
  const override = OVERRIDES[mapping.key];
  if (override) {
    return override;
  }
  if (mapping.key === "pens.presets") {
    return {
      type: "array",
      minItems: 1,
      maxItems: input.maxPens,
      items: penPreset,
    };
  }
  const tool = input.toolKeys[mapping.key];
  if (tool) {
    return {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        tool.map((name) => [
          name,
          schemaFromExpected(input.styleRules[name].expected, undefined) ?? {},
        ]),
      ),
    };
  }
  const fallback = input.defaults[mapping.field as string];
  const parsed =
    typeof mapping.expected === "string"
      ? schemaFromExpected(mapping.expected, fallback)
      : null;
  const schema = parsed ?? fromDefault(fallback);
  if (!schema) {
    throw new Error(`No schema for ${mapping.key}: add an override`);
  }
  return schema;
}

const OPEN_TABLE_SCHEMAS: Readonly<Record<string, Schema>> = {
  hotkeys: {
    type: "object",
    description:
      'One entry per command id: a list of keys like ["Mod+S"] or key sequences like ["g g"]; [] removes the default keys.',
    additionalProperties: stringList,
  },
  plugin: {
    type: "object",
    description: "[plugin.<id>]: the settings a plugin declares.",
    additionalProperties: { type: "object" },
  },
  commands: {
    type: "object",
    description:
      "[commands.<name>]: a user command, palette id `user.<name>`, running existing commands in order.",
    additionalProperties: {
      type: "object",
      additionalProperties: false,
      required: ["run"],
      properties: {
        title: { type: "string", description: "Palette label." },
        run: { ...stringList, minItems: 1, maxItems: 32 },
      },
    },
  },
  include: {
    type: "object",
    description: "Other TOML files or folders to read under this file.",
    additionalProperties: false,
    properties: { files: stringList },
  },
};

/** Extra keys of known tables that are not mapping rows. */
const EXTRA_KEYS: Readonly<Record<string, Readonly<Record<string, Schema>>>> = {
  keys: {
    labels: {
      type: "object",
      description: "Names of key groups shown in the which-key popup.",
      additionalProperties: { type: "string" },
    },
  },
};

/** Tables only the native side reads (NATIVE_KEYS in configKeys.ts). */
const NATIVE_TABLES: Readonly<Record<string, Schema>> = {
  control: {
    type: "object",
    description: "The control socket for the `vaultdraw` command.",
    additionalProperties: false,
    properties: {
      enabled: {
        description:
          "Start the control socket at launch; `false` turns the `vaultdraw` command's link to the app off.",
        default: true,
        type: "boolean",
      },
      uri_enabled: {
        description:
          "`false` ignores every `vaultdraw://` link and every drawing or library file opened from outside.",
        default: true,
        type: "boolean",
      },
      uri_allow: {
        description:
          'What a link may do without asking: "new", "switch-vault", or command ids.',
        default: [],
        type: "array",
        items: { type: "string" },
      },
    },
  },
};

/** The whole schema (draft-07, what Taplo supports best). */
export function buildConfigSchema(input: SchemaInput): Schema {
  const byKey = new Map(input.mappings.map((m) => [m.key, m]));
  const properties: Record<string, Schema> = {};
  for (const table of CONFIG_REFERENCE) {
    const keys: Record<string, Schema> = {};
    for (const [name, doc] of Object.entries(table.keys)) {
      const mapping = byKey.get(`${table.table}.${name}`);
      if (!mapping) {
        throw new Error(`No config mapping for ${table.table}.${name}`);
      }
      const value = input.defaults[mapping.field as string];
      keys[name] = {
        description: doc.doc,
        ...(value === undefined ? {} : { default: value }),
        ...keySchema(mapping, input),
      };
    }
    Object.assign(keys, EXTRA_KEYS[table.table] ?? {});
    properties[table.table] = {
      type: "object",
      description: table.intro,
      additionalProperties: false,
      properties: keys,
    };
  }
  for (const [table, schema] of Object.entries(NATIVE_TABLES)) {
    // A table the app also reads (`[control] notify_edits`) keeps both sets of keys.
    const known = properties[table];
    properties[table] = known
      ? {
          ...known,
          properties: {
            ...(known.properties as Schema),
            ...(schema.properties as Schema),
          },
        }
      : schema;
  }
  for (const table of OPEN_TABLES) {
    const schema = OPEN_TABLE_SCHEMAS[table];
    if (!schema) {
      throw new Error(`No schema for the open table [${table}]`);
    }
    properties[table] = schema;
  }
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Vaultdraw config.toml",
    description:
      "Generated from the app's key table by `yarn docs:config`; do not edit. Put `#:schema ./config.schema.json` at the top of config.toml (with this file next to it) for completion in Taplo-based editors.",
    type: "object",
    additionalProperties: false,
    properties,
  };
}

/** The file text: stable two-space JSON with a final newline. */
export const renderSchema = (schema: Schema): string =>
  `${JSON.stringify(schema, null, 2)}\n`;

// ---------------------------------------------------------------------------
// A validator for the subset of JSON Schema the generator emits (the same
// subset vaultdraw-core walks). Used by the agreement test.
// ---------------------------------------------------------------------------

const typeOk = (type: string, v: unknown): boolean =>
  type === "integer"
    ? typeof v === "number" && Number.isInteger(v)
    : type === "number"
    ? typeof v === "number" && Number.isFinite(v)
    : type === "array"
    ? Array.isArray(v)
    : type === "object"
    ? !!v && typeof v === "object" && !Array.isArray(v)
    : typeof v === type;

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Whether `value` satisfies `schema` (the generator's subset only). */
export function accepts(schema: Schema, value: unknown): boolean {
  if (schema.anyOf) {
    return (schema.anyOf as Schema[]).some((s) => accepts(s, value));
  }
  if ("const" in schema && !same(schema.const, value)) {
    return false;
  }
  if (schema.enum && !(schema.enum as unknown[]).some((e) => same(e, value))) {
    return false;
  }
  if (typeof schema.type === "string" && !typeOk(schema.type, value)) {
    return false;
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      return false;
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      return false;
    }
    if (
      typeof schema.exclusiveMinimum === "number" &&
      value <= schema.exclusiveMinimum
    ) {
      return false;
    }
  }
  if (typeof value === "string") {
    if (
      typeof schema.minLength === "number" &&
      value.length < schema.minLength
    ) {
      return false;
    }
    if (
      typeof schema.maxLength === "number" &&
      value.length > schema.maxLength
    ) {
      return false;
    }
    if (
      typeof schema.format === "string" &&
      !new RegExp(FORMATS[schema.format as keyof typeof FORMATS]).test(value)
    ) {
      return false;
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      return false;
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      return false;
    }
    if (
      schema.items &&
      !value.every((v) => accepts(schema.items as Schema, v))
    ) {
      return false;
    }
  }
  if (
    typeOk("object", value) &&
    (schema.properties || schema.additionalProperties !== undefined)
  ) {
    const record = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    for (const name of (schema.required as string[] | undefined) ?? []) {
      if (!(name in record)) {
        return false;
      }
    }
    for (const [name, v] of Object.entries(record)) {
      const sub = props[name];
      if (sub) {
        if (!accepts(sub, v)) {
          return false;
        }
      } else if (schema.additionalProperties === false) {
        return false;
      } else if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === "object" &&
        !accepts(schema.additionalProperties as Schema, v)
      ) {
        return false;
      }
    }
  }
  return true;
}
