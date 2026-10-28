import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  accepts,
  keySchema,
  schemaFromExpected,
  SCHEMA_PATH,
  type Schema,
} from "../vault/configSchema";
import { currentSchema, schemaInput } from "../vault/configReferenceDoc";
import { NATIVE_KEYS } from "../vault/configKeys";
import { CONFIG_MAPPING, unknownKeyProblems } from "../vault/settingsSync";
import { STYLE_KEY_RULES } from "../toolDefaults/toolStyles";
import { DEFAULT_PEN_PRESETS, penPresetProblem } from "../pens/penPresets";

const root = resolve(__dirname, "../../..");

/**
 * Keys whose app check is stricter than JSON Schema can say (folder rules,
 * key names, plugin ids, distinct letters): the schema may accept a value the
 * app rejects, never the other way round.
 */
const LOOSER_THAN_APP = new Set([
  "appearance.theme",
  "files.new_drawing_folder",
  "files.templates_folder",
  "links.hint_chars",
  "keys.leader",
  "plugins.enabled",
  "interface.activity_bar_order",
  "interface.activity_bar_hidden",
  "themes.index_url",
  "plugins.registry_url",
]);

/** Values around each limit the schema states, plus wrong types. */
function probes(schema: Schema, fallback: unknown): unknown[] {
  const out: unknown[] = [
    fallback,
    true,
    false,
    "zznotavalue",
    "",
    "#abc",
    "#aabbcc",
    "#ggg",
    "red",
    0,
    1,
    -1,
    2.5,
    1e9,
    -1e9,
    [],
    ["x"],
    {},
  ];
  const walk = (s: Schema) => {
    for (const v of (s.enum as unknown[] | undefined) ?? []) {
      out.push(v);
    }
    if ("const" in s) {
      out.push(s.const);
    }
    const step = s.type === "integer" ? 1 : 0.001;
    for (const bound of [s.minimum, s.maximum, s.exclusiveMinimum]) {
      if (typeof bound === "number") {
        out.push(bound, bound - step, bound + step, bound + 0.5);
      }
    }
    ((s.anyOf as Schema[] | undefined) ?? []).forEach(walk);
  };
  walk(schema);
  return out;
}

describe("config schema", () => {
  it(`${SCHEMA_PATH} is up to date (run yarn docs:config)`, () => {
    const file = readFileSync(resolve(root, SCHEMA_PATH), "utf8");
    expect(file).toBe(currentSchema());
  });

  it("covers every key, and every open table", () => {
    const schema = JSON.parse(currentSchema());
    for (const { key } of CONFIG_MAPPING) {
      const [table, name] = key.split(".");
      expect(schema.properties[table].properties[name], key).toBeDefined();
    }
    for (const key of NATIVE_KEYS) {
      const [table, name] = key.split(".");
      expect(schema.properties[table].properties[name], key).toBeDefined();
    }
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(["hotkeys", "plugin", "include"]),
    );
  });

  it("agrees with each key's validator: never stricter, and as strict where it can be", () => {
    const input = schemaInput();
    const mismatches: string[] = [];
    for (const mapping of CONFIG_MAPPING) {
      if (mapping.key === "pens.presets" || mapping.key.startsWith("tools.")) {
        continue; // tables: checked below
      }
      const schema = keySchema(mapping, input);
      const fallback = input.defaults[mapping.field];
      for (const value of probes(schema, fallback)) {
        const normalized = mapping.normalize ? mapping.normalize(value) : value;
        const app = mapping.valid(normalized);
        const ours = accepts(schema, value);
        if (app && !ours) {
          mismatches.push(
            `${mapping.key}: schema rejects ${JSON.stringify(value)}`,
          );
        }
        if (!app && ours && !LOOSER_THAN_APP.has(mapping.key)) {
          mismatches.push(
            `${mapping.key}: schema accepts ${JSON.stringify(value)}`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("agrees with every tool style key's validator", () => {
    const mismatches: string[] = [];
    for (const [name, rule] of Object.entries(STYLE_KEY_RULES)) {
      const schema = schemaFromExpected(rule.expected, undefined) ?? {};
      for (const value of probes(schema, undefined)) {
        if (value === undefined) {
          continue;
        }
        if (rule.valid(value) !== accepts(schema, value)) {
          mismatches.push(`${name}: ${JSON.stringify(value)}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("accepts the default pens and rejects a broken one", () => {
    const pens = CONFIG_MAPPING.find((m) => m.key === "pens.presets")!;
    const input = schemaInput();
    const schema = keySchema(pens, input);
    const fallback = input.defaults[pens.field];
    expect(accepts(schema, fallback)).toBe(true);
    expect(accepts(schema, [{ name: "Pen", color: "#000000", width: 2 }])).toBe(
      true,
    );
    expect(
      accepts(schema, [{ name: "Pen", color: "#000000", width: 2, id: "x" }]),
    ).toBe(true);
    expect(penPresetProblem({ ...DEFAULT_PEN_PRESETS[0], id: "x" })).toBe(null);
    expect(
      accepts(schema, [{ name: "Pen", color: "#000000", width: 99 }]),
    ).toBe(false);
    expect(accepts(schema, [])).toBe(false);
  });

  it("native-only keys are known to the app's unknown-key check", () => {
    expect(unknownKeyProblems({ control: { enabled: false } })).toEqual([]);
  });

  it("reads the expected texts the app writes", () => {
    expect(schemaFromExpected('"light", "dark" or "system"', "system")).toEqual(
      {
        type: "string",
        enum: ["light", "dark", "system"],
      },
    );
    expect(
      schemaFromExpected(
        "0 (unset) or a whole number of pixels between 100 and 5000",
        0,
      ),
    ).toEqual({
      anyOf: [{ const: 0 }, { type: "integer", minimum: 100, maximum: 5000 }],
    });
    expect(schemaFromExpected("a number between 0.1 and 1", 1)).toEqual({
      type: "number",
      minimum: 0.1,
      maximum: 1,
    });
    expect(schemaFromExpected("one of 1, 2, 3", 1)).toEqual({
      enum: [1, 2, 3],
    });
  });
});
