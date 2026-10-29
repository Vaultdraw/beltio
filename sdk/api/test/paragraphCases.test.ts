/**
 * Family: line breaks and the order of text and pictures inside a paragraph read the same in the
 * Rust parser and in the browser stand-in. One table, read by both suites
 * (`vaultdraw-core/src/markdown/paragraph_cases.json`).
 */
import { describe, expect, test } from "vitest";

import cases from "../../../excalidraw-desktop/src-tauri/crates/vaultdraw-core/src/markdown/paragraph_cases.json";
import { fakeParseMarkdown } from "../shared/markdown";

type Case = {
  name: string;
  input: string;
  softBreakNewline: boolean;
  blocks: [string, string][];
};

describe("paragraph cases (shared table with the Rust parser)", () => {
  test.each(cases as Case[])("$name", (c) => {
    const doc = fakeParseMarkdown(c.input, {
      softBreakNewline: c.softBreakNewline,
    });
    const got = doc.blocks.map((b) => {
      const x = b as { kind: string; text?: string; target?: string };
      return [x.kind, x.kind === "paragraph" ? x.text : x.target];
    });
    expect(got).toEqual(c.blocks);
  });
});
