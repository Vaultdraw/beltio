/**
 * Regenerates the "Every key" section of docs/configuration.md from the
 * app's config key table. `--check` only reports whether it is stale.
 *
 *   yarn docs:config          # write
 *   yarn docs:config --check  # exit 1 when stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { spliceReference } from "../src/vault/configReference";
import { currentReference, DOC_PATH } from "../src/vault/configReferenceDoc";

const file = fileURLToPath(new URL(`../../${DOC_PATH}`, import.meta.url));
const doc = readFileSync(file, "utf8");
const next = spliceReference(doc, currentReference());

if (next === doc) {
  process.stdout.write(`${DOC_PATH} is up to date\n`);
} else if (process.argv.includes("--check")) {
  console.error(`${DOC_PATH} is stale: run yarn docs:config`);
  process.exit(1);
} else {
  writeFileSync(file, next);
  process.stdout.write(`updated ${DOC_PATH}\n`);
}
