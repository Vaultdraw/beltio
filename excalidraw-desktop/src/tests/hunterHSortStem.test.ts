import { describe, expect, it } from "vitest";

import { entryDisplayName } from "../vault/fileKind";
import { sortEntries } from "../vault/sortOrder";

import type { VaultEntry } from "../vault/types";

/**
 * Hunter H-1 (2026-10-30). `compareEntries` compares the file name WITH its extension, so the
 * "." of the extension is weighed against the " " of "Untitled 2". The row label hides the
 * extension, so the user sees "Untitled 2, Untitled 10, Untitled" (the shorter name last).
 * Zed and Obsidian compare the name without the extension first.
 */
const e = (name: string, kind: VaultEntry["kind"]): VaultEntry => ({
  path: name,
  name,
  kind,
  modifiedAt: 0,
  size: 0,
});

describe("hunter H-1: A to Z sorts by the shown name, not the file name", () => {
  it.fails("Untitled comes before Untitled 2 and Untitled 10", () => {
    const shown = sortEntries(
      [
        e("Untitled 10.excalidraw", "drawing"),
        e("Untitled.excalidraw", "drawing"),
        e("Untitled 2.excalidraw", "drawing"),
      ],
      "name_asc",
    ).map((x) => entryDisplayName(x.name));
    expect(shown).toEqual(["Untitled", "Untitled 2", "Untitled 10"]);
  });

  it.fails("a note and a drawing: Notes before Notes 2", () => {
    const shown = sortEntries(
      [e("Notes 2.excalidraw", "drawing"), e("Notes.md", "note")],
      "name_asc",
    ).map((x) => entryDisplayName(x.name));
    expect(shown).toEqual(["Notes", "Notes 2"]);
  });
});
