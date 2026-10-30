// Twins (testing.md): the app's plugin loader (manifest.rs) and `vaultdraw-plugin check` decide the
// same thing, whether a plugin.toml can load. One case table pins both; Rust runs the same rows in
// `plugins::tests::plugin_compat_contract_table`. A row with `check_known` is a gap in the check
// tool (its toimprove entry) and flips to a pass when fixed (validator, hunter M-4, 2026-10-30 night).
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateManifestText } from "../src/manifest.mjs";

import { SDK } from "./helpers.mjs";

const table = JSON.parse(
  readFileSync(
    path.join(
      SDK,
      "../excalidraw-desktop/src-tauri/crates/vaultdraw-core/src/contract/plugin_compat_cases.json",
    ),
    "utf8",
  ),
);

describe("plugin compatibility contract (loader and check agree)", () => {
  for (const row of table.cases) {
    const text = `${table.base}api = ${row.api}\n${
      row.min_api ? `min_api = "${row.min_api}"\n` : ""
    }`;
    (row.check_known ? it.fails : it)(
      `${row.label}: ${row.loads ? "no error" : "an error"}`,
      () => {
        expect(validateManifestText(text).errors.length > 0).toBe(!row.loads);
      },
    );
  }
});
