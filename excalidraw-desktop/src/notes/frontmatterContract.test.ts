/**
 * Twins share one case table (testing.md): the reading view's front matter strip and the browser
 * stand-in run the rows of vaultdraw-core/src/contract/frontmatter_cases.json; the native parser
 * runs the same rows in vaultdraw-core/tests/frontmatter_contract.rs. A row's `drift` marks a copy
 * that disagrees today (`it.fails`, with the toimprove number); delete it when fixed.
 */
import { describe, expect, it } from "vitest";

import table from "../../src-tauri/crates/vaultdraw-core/src/contract/frontmatter_cases.json";

import { standInNoteDoc } from "./noteDoc";
import { stripFrontmatter } from "./render/obsidian";

type Row = {
  label: string;
  text: string;
  hidden: boolean;
  tags: string[];
  drift?: { native?: string; standIn?: string; reading?: string };
};

describe("front matter: every copy agrees with Obsidian", () => {
  for (const r of table.cases as Row[]) {
    (r.drift?.reading ? it.fails : it)(
      `reading view hides it: ${r.label}`,
      () => {
        expect(stripFrontmatter(r.text) !== r.text).toBe(r.hidden);
      },
    );
    (r.drift?.standIn ? it.fails : it)(
      `browser stand-in tags: ${r.label}`,
      () => {
        expect(standInNoteDoc(r.text).frontmatter?.tags ?? []).toEqual(r.tags);
      },
    );
  }
});
