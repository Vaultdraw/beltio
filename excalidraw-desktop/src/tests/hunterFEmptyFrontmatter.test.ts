import { describe, expect, it } from "vitest";

import { stripFrontmatter } from "../notes/render/obsidian";

/**
 * Hunter F-10 (2026-10-30). The reading view's `FRONTMATTER` pattern (`notes/render/obsidian.ts`)
 * needs a newline between the opening and the closing `---`, so an EMPTY properties block
 * (`---` directly followed by `---`, what a template or an emptied note leaves) is not stripped and
 * shows as two horizontal rules. Obsidian hides the block.
 */
describe("hunter F-10: an empty frontmatter block is hidden in the reading view", () => {
  it("(context) a block with a property is stripped", () => {
    expect(stripFrontmatter("---\ntitle: a\n---\nBody")).toBe("Body");
  });
  it("---\\n---\\nBody reads as Body", () => {
    expect(stripFrontmatter("---\n---\nBody")).toBe("Body");
  });
  it("the same with Windows line ends", () => {
    expect(stripFrontmatter("---\r\n---\r\nBody")).toBe("Body");
  });
});
