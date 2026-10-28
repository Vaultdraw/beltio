import { describe, expect, it } from "vitest";

import { newNotePathForLink } from "./noteLinks";

// Family: every "create a note at a typed path" (bug hunt BH-9). Obsidian: folders in the
// target are vault-relative and get created, `./`/`../` are relative, `.md` is never doubled.
const rows: [from: string, target: string, expected: string | null][] = [
  ["Inbox/Today.md", "Idea", "Inbox/Idea.md"],
  ["Today.md", "Idea", "Idea.md"],
  ["Inbox/Today.md", "Projects/Idea", "Projects/Idea.md"],
  ["Inbox/Today.md", "Projects/2026/Idea", "Projects/2026/Idea.md"],
  ["Inbox/Today.md", "/Projects/Idea", "Projects/Idea.md"],
  ["Inbox/Today.md", "Foo.md", "Inbox/Foo.md"],
  ["Inbox/Today.md", "Foo.MD", "Inbox/Foo.MD"],
  ["Inbox/Today.md", "Projects/Foo.md", "Projects/Foo.md"],
  ["Inbox/Today.md", "./Idea", "Inbox/Idea.md"],
  ["Inbox/Deep/Today.md", "../Idea", "Inbox/Idea.md"],
  ["Inbox/Today.md", "../Idea", "Idea.md"],
  ["Today.md", "../Idea", null],
  ["Inbox/Today.md", "Big Ideas 2026", "Inbox/Big Ideas 2026.md"],
  ["Inbox/Today.md", "Sketch.excalidraw.md", "Inbox/Sketch.excalidraw.md.md"],
  ["Inbox/Today.md", ".obsidian/x", null],
  ["Inbox/Today.md", "a//b", null],
  ["Inbox/Today.md", "bad:name", null],
  ["Inbox/Today.md", "   ", null],
  ["Inbox/Today.md", "Projects/../../x", null],
];

describe("newNotePathForLink: where an unresolved [[link]] creates its note", () => {
  it.each(rows)("from %s, [[%s]] -> %s", (from, target, expected) => {
    expect(newNotePathForLink(from, target)).toBe(expected);
  });
});
