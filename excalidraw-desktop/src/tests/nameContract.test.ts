import { describe, expect, it } from "vitest";

import table from "../../src-tauri/crates/vaultdraw-core/src/contract/entry_names.json";
import { validateEntryName } from "../vault/treeStore";

// Hunter D round 2 (2026-10-30): the Name dialogs accepted names the native backend refuses
// ("Path contains an invalid component"): `a?b`, a newline, CON, 128 accented letters. One table
// (entry_names.json) is read here and by paths.rs; the dialog must refuse every name the backend does.
type Row = {
  label: string;
  name: string | { repeat: string; times: number };
  kind: "drawing" | "folder";
  backendOk: boolean;
};
const nameOf = (r: Row) =>
  typeof r.name === "string" ? r.name : r.name.repeat.repeat(r.name.times);

describe("entry names: the dialog agrees with the backend", () => {
  for (const r of table.cases as Row[]) {
    it(`${r.kind}: ${r.label}`, () => {
      // The Rename and Save-as-template dialogs check the name with its extension, as typed.
      const full = r.kind === "drawing" ? `${nameOf(r)}.excalidraw` : nameOf(r);
      const v = validateEntryName(full, r.kind);
      expect(v.valid, v.error).toBe(r.backendOk);
    });
  }
});
