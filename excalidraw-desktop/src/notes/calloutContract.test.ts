// @vitest-environment jsdom
/**
 * Which text is a callout: the reading view runs the case table the native parser runs
 * (`vaultdraw-core/tests/callout_contract.rs`). Family "twin parsers", hunter [notes] 2026-10-31.
 * A row with `drift.reading` disagrees today (`it.fails`).
 */
import { describe, expect, it } from "vitest";

import table from "../../src-tauri/crates/vaultdraw-core/src/contract/callout_cases.json";

import { renderNoteHtml } from "./render/obsidian";
import { sanitizeNoteHtml } from "./render/sanitize";

type Row = {
  label: string;
  text: string;
  callouts: string[][];
  drift?: { native?: string; reading?: string };
};

const viewCallouts = (md: string): string[][] => {
  const div = document.createElement("div");
  div.innerHTML = sanitizeNoteHtml(
    renderNoteHtml(md, { resolve: () => null, highlight: false, math: true }),
    { remoteImages: false },
  );
  return [...div.querySelectorAll<HTMLElement>(".callout")].map((c) => [
    c.dataset.callout ?? "",
    c.tagName === "DETAILS"
      ? c.hasAttribute("open")
        ? "open"
        : "closed"
      : "none",
  ]);
};

describe("callouts: the reading view agrees with the native parser's table", () => {
  for (const r of table.cases as Row[]) {
    (r.drift?.reading ? it.fails : it)(r.label, () => {
      expect(viewCallouts(r.text)).toEqual(r.callouts);
    });
  }
});
