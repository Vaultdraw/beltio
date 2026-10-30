import { describe, expect, it } from "vitest";

import table from "../../src-tauri/crates/vaultdraw-core/src/contract/fold_cases.json";
import { foldKey } from "../links/resolve";
import { tagKey } from "../tags/grammar";

/**
 * Twins share one case table (testing.md). The native index folds tag and link keys with
 * search/normalize.rs (`fold_cases_contract_table` runs these rows); the TypeScript copies below
 * fold what the user types and compare it with those keys. Hunter F-4 (2026-10-30): the # popup
 * found no tag typed with ß, ł, ø, æ or voiced kana, because the copies have no fold map and strip
 * every mark. KNOWN_DRIFT rows would be `it.fails`; empty since both copies use search/foldKey.ts (toimprove 178, 179).
 */
type Row = { label: string; input: string; folded: string };

const TWINS: Record<string, (s: string) => string> = { tagKey, foldKey };

const KNOWN_DRIFT = new Set<string>([]);

describe("fold: every TypeScript copy agrees with the search index", () => {
  for (const [twin, fold] of Object.entries(TWINS)) {
    for (const r of table.cases as Row[]) {
      const name = `${twin}: ${r.label}`;
      const test = KNOWN_DRIFT.has(name) ? it.fails : it;
      test(`${name} (${r.input} -> ${r.folded})`, () => {
        expect(fold(r.input).normalize("NFC")).toBe(r.folded.normalize("NFC"));
      });
    }
  }
});
