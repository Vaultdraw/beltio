// @vitest-environment jsdom
/**
 * Which text is a `[[wikilink]]`: the reading view runs the case table the native parser runs
 * (`vaultdraw-core/tests/wikilink_contract.rs`). Family "twin parsers", hunter [notes] 2026-10-31.
 * A row with `drift.reading` disagrees today (`it.fails`).
 */
import { describe, expect, it } from "vitest";

import table from "../../src-tauri/crates/vaultdraw-core/src/contract/wikilink_cases.json";

import { renderNoteHtml } from "./render/obsidian";
import { sanitizeNoteHtml } from "./render/sanitize";

type Row = {
  label: string;
  text: string;
  links: string[];
  drift?: { native?: string; reading?: string };
};

const viewTargets = (md: string): string[] => {
  const div = document.createElement("div");
  div.innerHTML = sanitizeNoteHtml(
    renderNoteHtml(md, { resolve: () => null, highlight: false, math: true }),
    { remoteImages: false },
  );
  return [...div.querySelectorAll<HTMLElement>("a.wikilink")].map(
    (a) => a.dataset.target ?? "",
  );
};

describe("wikilinks: the reading view agrees with the native parser's table", () => {
  for (const r of table.cases as Row[]) {
    it(r.label, () => {
      expect(viewTargets(r.text)).toEqual(r.links);
    });
  }
});
