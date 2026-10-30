import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

// actionlint rejected linux.yml: an unquoted `${{ ... }}` inside a flow mapping is read as a
// nested mapping. Every workflow must at least parse as YAML.
const dir = resolve(__dirname, "../../../.github/workflows");

describe("GitHub workflows", () => {
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".yml"))) {
    it(`${f} parses as YAML with jobs`, () => {
      const doc = parse(readFileSync(resolve(dir, f), "utf8"));
      expect(Object.keys(doc.jobs).length).toBeGreaterThan(0);
    });
  }
});
