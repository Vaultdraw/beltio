import { describe, expect, it } from "vitest";

import table from "../../src-tauri/crates/vaultdraw-core/src/contract/theme_names.json";
import { validateCandidate } from "../theme/install/installer";

/**
 * Twins share one case table (testing.md). Look up's name pre-check (validateCandidate, toimprove
 * 158) and the native install (theme_install.rs sanitize_name, which runs the same table in
 * `theme_name_contract_table`) must give the same answer for every theme name, so the user never
 * meets a refusal only after pressing Install, nor a refusal the install would not make.
 * Hunter F-1 and F-2 (2026-10-30): the pre-check borrowed the folder rule (255 bytes, no `source`
 * rule, bidirectional characters allowed, a trailing dot refused as "Folder names ...").
 * KNOWN_DRIFT rows would fail today (`it.fails`); empty since the pre-check follows the install (toimprove 175, 176).
 */
type Row = {
  label: string;
  name: string | { repeat: string; times: number };
  backendOk: boolean;
  lookUpOk?: boolean;
};
const nameOf = (r: Row) =>
  typeof r.name === "string" ? r.name : r.name.repeat.repeat(r.name.times);

const KNOWN_DRIFT = new Set<string>([]);

const colours =
  '"dark":{"mPrimary":"#123456","mSurface":"#101010","mOnSurface":"#eeeeee"}';

const lookUp = (name: string): { ok: boolean; message: string } => {
  try {
    validateCandidate(`{"name":${JSON.stringify(name)},${colours}}`, "x");
    return { ok: true, message: "" };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
};

describe("theme names: Look up agrees with the install", () => {
  for (const r of table.cases as Row[]) {
    const test = KNOWN_DRIFT.has(r.label) ? it.fails : it;
    test(`${r.label}: ${r.backendOk ? "accepted" : "refused"}`, () => {
      const { ok, message } = lookUp(nameOf(r));
      expect(ok, message).toBe(r.lookUpOk ?? r.backendOk);
      // a refusal speaks of the theme, never of a folder or drawing (F-2)
      expect(message).not.toMatch(/folder|drawing/i);
    });
  }
});
