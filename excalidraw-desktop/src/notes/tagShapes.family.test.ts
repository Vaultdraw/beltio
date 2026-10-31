// @vitest-environment jsdom
/**
 * Family "twin parsers: tags" (J-8 pinned a list of shapes where the reading-view chips and the
 * tag pane's grammar agree). This sweep adds the shapes that sit inside OTHER syntax: where a `#`
 * is not a tag in Obsidian (code, urls, link targets, headings, html, math, comments) and where
 * it is (list items, quotes, callouts, tables, emphasis). For each source the chips of the reading
 * view must be exactly the table's tags; the native parser runs the same rows
 * (`vaultdraw-core/tests/note_tag_contract.rs`, toimprove 322 for its two drifts).
 */
import { describe, expect, it } from "vitest";

import table from "../../src-tauri/crates/vaultdraw-core/src/contract/note_tag_cases.json";
import { findTags } from "../tags/grammar";

import { renderNoteHtml } from "./render/obsidian";
import { sanitizeNoteHtml } from "./render/sanitize";

const chips = (md: string): string[] => {
  const div = document.createElement("div");
  div.innerHTML = sanitizeNoteHtml(
    renderNoteHtml(md, { resolve: () => null, highlight: false, math: true }),
    { remoteImages: false },
  );
  return [...div.querySelectorAll<HTMLElement>(".note-tag")].map(
    (e) => e.dataset.tag ?? "",
  );
};

type Row = {
  label: string;
  text: string;
  tags: string[];
  drift?: { native?: string };
};
const rows = table.cases as Row[];

describe("tag chips in the reading view, by the syntax around the #", () => {
  for (const r of rows) {
    it(r.label, () => {
      expect(chips(r.text)).toEqual(r.tags);
    });
  }
});

describe("the same sources in the tag pane's grammar (findTags) for the plain-text rows", () => {
  for (const r of rows.filter((x) =>
    /^(plain|nested tag|a hash then space|a number tag|twice)/.test(x.label),
  )) {
    it(r.label, () => {
      expect(findTags(r.text).map((m) => m.display)).toEqual(r.tags);
    });
  }
});
