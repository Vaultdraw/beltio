/**
 * test-net-2: the end-to-end family specs (e2e/families/registry-*.spec.ts) read this snapshot of the
 * app's own registries, so a new command, setting or default key is picked up without anyone
 * remembering to add a test row. Playwright specs cannot import the app source (it needs bundler
 * features), so a unit test writes the file and fails when it is stale:
 *   UPDATE_REGISTRY_SNAPSHOT=1 npx vitest run src/commands/registrySnapshot.test.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SETTINGS_PAGES, SETTINGS_SCHEMA } from "../components/settings/schema";

import { COMMANDS, defaultKeys } from "./commands";

const FILE = path.resolve(
  __dirname,
  "../../e2e/families/registry-snapshot.json",
);

const build = () => ({
  commands: COMMANDS.map((c) => ({
    id: c.id,
    title: c.title,
    category: c.category,
    keys: defaultKeys(c, "mac"),
    when: c.when ?? [],
    palette: c.palette !== false,
  })),
  settings: SETTINGS_SCHEMA.map((s) => ({
    id: s.id,
    page: s.page,
    label: s.label,
    configKey: s.configKey ?? null,
    section: s.section ?? null,
  })),
  pages: SETTINGS_PAGES.map((p) => ({ id: p.id, label: p.label })),
});

describe("registry snapshot for the family specs", () => {
  it("is up to date", () => {
    const text = `${JSON.stringify(build(), null, 1)}\n`;
    if (process.env.UPDATE_REGISTRY_SNAPSHOT === "1") {
      writeFileSync(FILE, text);
    }
    expect(
      readFileSync(FILE, "utf8"),
      "registry changed: run UPDATE_REGISTRY_SNAPSHOT=1 npx vitest run src/commands/registrySnapshot.test.ts",
    ).toBe(text);
  });
});
