import fs from "node:fs";

import Ajv from "ajv";
import { describe, expect, it } from "vitest";

import {
  DOC_FILE,
  EXAMPLE,
  SCHEMA_FILE,
  generate,
} from "../scripts/gen-manifest-docs.mjs";
import { parseToml } from "../../cli/src/toml.mjs";

describe("sdk/docs/manifest.md", () => {
  it("matches what plugin.schema.json generates", () => {
    const actual: string = generate();
    if (process.env.UPDATE_MANIFEST_DOCS === "1") {
      fs.writeFileSync(DOC_FILE, actual);
      return;
    }
    const expected = fs.existsSync(DOC_FILE)
      ? fs.readFileSync(DOC_FILE, "utf8")
      : "";
    expect(
      actual === expected,
      "sdk/docs/manifest.md is out of date. Run " +
        "`node sdk/api/scripts/gen-manifest-docs.mjs` (or " +
        "`UPDATE_MANIFEST_DOCS=1 npx vitest run sdk/api/test/manifestDocs.test.ts`) " +
        "and commit it.",
    ).toBe(true);
  });

  it("starts with the generated-file header", () => {
    expect(generate().split("\n")[0]).toContain(
      "Generated from plugin.schema.json by sdk/api/scripts/gen-manifest-docs.mjs. Do not edit.",
    );
  });

  it("shows an example that the schema accepts", () => {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_FILE, "utf8"));
    const validate = new Ajv({ strict: false }).compile(schema);
    const doc = JSON.parse(JSON.stringify(parseToml(EXAMPLE)));
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });
});
