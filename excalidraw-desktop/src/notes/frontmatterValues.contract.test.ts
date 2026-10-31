/**
 * Front matter property VALUES: the browser stand-in runs the same case table as the native parser
 * (`vaultdraw-core/tests/frontmatter_values.rs`). Family "twin parsers", hunter [notes] 2026-10-31,
 * toimprove 315, 316. A row with `drift.standIn` disagrees today (`it.fails`).
 */
import { describe, expect, it } from "vitest";

import table from "../../src-tauri/crates/vaultdraw-core/src/contract/frontmatter_values.json";

import { standInNoteDoc } from "./noteDoc";

type Row = {
  label: string;
  yaml: string;
  props: [string, string][];
  drift?: { native?: string; standIn?: string };
};

describe("front matter values: the browser stand-in agrees with the table", () => {
  for (const r of table.cases as Row[]) {
    (r.drift?.standIn ? it.fails : it)(r.label, () => {
      const doc = standInNoteDoc(`---\n${r.yaml}\n---\nbody\n`);
      expect(Object.entries(doc.frontmatter?.properties ?? {})).toEqual(
        r.props,
      );
    });
  }
});
