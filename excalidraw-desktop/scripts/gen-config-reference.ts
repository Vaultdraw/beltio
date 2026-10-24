/**
 * Regenerates the "Every key" section of docs/configuration.md and
 * docs/config.schema.json from the app's config key table. `--check` only
 * reports whether either is stale.
 *
 *   yarn docs:config          # write
 *   yarn docs:config --check  # exit 1 when stale
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { spliceReference } from "../src/vault/configReference";
import {
  currentReference,
  currentSchema,
  DOC_PATH,
} from "../src/vault/configReferenceDoc";
import { SCHEMA_PATH } from "../src/vault/configSchema";

const at = (path: string) =>
  fileURLToPath(new URL(`../../${path}`, import.meta.url));

const outputs: [string, (current: string) => string][] = [
  [DOC_PATH, (doc) => spliceReference(doc, currentReference())],
  [SCHEMA_PATH, () => currentSchema()],
];

let stale = false;
for (const [path, render] of outputs) {
  const file = at(path);
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const next = render(current);
  if (next === current) {
    process.stdout.write(`${path} is up to date\n`);
  } else if (process.argv.includes("--check")) {
    console.error(`${path} is stale: run yarn docs:config`);
    stale = true;
  } else {
    writeFileSync(file, next);
    process.stdout.write(`updated ${path}\n`);
  }
}
process.exit(stale ? 1 : 0);
