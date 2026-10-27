import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ajv is a transitive dev dependency (eslint); it is used by this test only.
import Ajv from "ajv";
import { describe, expect, it } from "vitest";

import { TOP_KEYS } from "../../cli/src/manifest.mjs";
import { parseToml } from "../../cli/src/toml.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpus = path.join(root, "test", "manifests");
const schema = JSON.parse(
  fs.readFileSync(path.join(root, "plugin.schema.json"), "utf8"),
);

const ajv = new Ajv({ strict: false, allErrors: true });
const validate = ajv.compile(schema);

/** parseToml returns null-prototype objects; JSON shape is a plain round trip. */
const toJson = (text: string): unknown =>
  JSON.parse(JSON.stringify(parseToml(text)));

const files = (dir: string) =>
  fs
    .readdirSync(path.join(corpus, dir))
    .filter((f) => f.endsWith(".toml"))
    .sort()
    .map((f) => {
      const text = fs.readFileSync(path.join(corpus, dir, f), "utf8");
      const code = /^# code: (\S+)/m.exec(text)?.[1] ?? "";
      return { name: f, text, code };
    });

/** Codes of the corpus that a JSON Schema cannot express, each with the reason. */
const NOT_EXPRESSIBLE: Record<string, string> = {
  "toml-parse": "the text is not TOML, so there is no document to validate",
  "manifest-too-large": "a limit on the size of the file, not of the document",
  "dev-true": "valid for the app; only a packaged manifest must not set it",
  "contribution-duplicate": "uniqueness of a property of array items",
  "data-key-reserved": "depends on the plugin id (plugins.<id>)",
  "status-command-unknown":
    "a reference to a command id declared elsewhere in the manifest",
};

describe("plugin.schema.json", () => {
  it("is a draft-07 schema with $schema and $id", () => {
    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(() => new URL(schema.$id)).not.toThrow();
    expect(ajv.validateSchema(schema)).toBe(true);
    expect(schema.$comment).toMatch(/cannot express/);
  });

  it("lists the same top-level keys as the CLI validator", () => {
    expect(Object.keys(schema.properties).sort()).toEqual([...TOP_KEYS].sort());
  });

  it("gives every property a title and a description", () => {
    const missing: string[] = [];
    const walk = (node: any, where: string) => {
      if (typeof node !== "object" || node === null) {
        return;
      }
      for (const [k, v] of Object.entries<any>(node.properties ?? {})) {
        if (!v.title || !v.description) {
          missing.push(`${where}.${k}`);
        }
        walk(v, `${where}.${k}`);
      }
      for (const [k, v] of Object.entries<any>(node.definitions ?? {})) {
        walk(v, `#${k}`);
      }
      if (node.items) {
        walk(node.items, `${where}[]`);
      }
    };
    walk(schema, "$");
    expect(missing).toEqual([]);
  });

  it.each(files("ok"))("accepts ok/$name", ({ text }) => {
    const doc = toJson(text);
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  const bad = files("bad");

  it("knows every code of the bad corpus", () => {
    for (const { name, code } of bad) {
      expect(code, name).not.toBe("");
    }
  });

  it.each(bad.filter((f) => !(f.code in NOT_EXPRESSIBLE)))(
    "rejects bad/$name ($code)",
    ({ text }) => {
      expect(validate(toJson(text))).toBe(false);
    },
  );

  it("does not list a code as unexpressible that the corpus lacks", () => {
    const codes = new Set(bad.map((f) => f.code));
    for (const c of Object.keys(NOT_EXPRESSIBLE)) {
      expect(codes.has(c), c).toBe(true);
    }
  });

  it("enforces the limits of the Rust manifest", () => {
    const base = {
      id: "demo-plugin",
      name: "D",
      version: "1.0.0",
      api: 0,
      main: "main.js",
    };
    const ok = (d: object) => validate({ ...base, ...d });
    expect(ok({})).toBe(true);
    expect(ok({ name: "x".repeat(201) })).toBe(false);
    expect(ok({ description: "x".repeat(1001) })).toBe(false);
    expect(ok({ id: "a" })).toBe(false);
    expect(ok({ id: "a".repeat(40) })).toBe(false);
    expect(ok({ id: "a".repeat(39) })).toBe(true);
    expect(ok({ main: "a/./b.js" })).toBe(false);
    expect(ok({ main: "/abs.js" })).toBe(false);
    expect(ok({ main: "dist/main.js" })).toBe(true);
    expect(ok({ version: "01.0.0" })).toBe(false);
    expect(ok({ version: "1.0.0-beta.1+build" })).toBe(true);
    expect(ok({ "x-build": {} })).toBe(true);
    expect(ok({ "x-build": "no" })).toBe(false);
    const cmd = (i: number) => ({ id: `c${i}`, title: "T" });
    const many = (n: number) => ({
      contributes: { commands: Array.from({ length: n }, (_, i) => cmd(i)) },
    });
    expect(ok(many(200))).toBe(true);
    expect(ok(many(201))).toBe(false);
  });
});
