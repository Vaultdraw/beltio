import { describe, expect, it } from "vitest";

import { folderTrashMessage } from "./trashMessage";

describe("folderTrashMessage", () => {
  it("names the folder and its item count", () => {
    expect(folderTrashMessage("Ideas", { count: 12, capped: false })).toContain(
      "\u201cIdeas\u201d and its 12 items",
    );
    expect(folderTrashMessage("Ideas", { count: 1, capped: false })).toContain(
      "its 1 item to",
    );
  });
  it("says 1,000+ for a huge folder", () => {
    expect(folderTrashMessage("Big", { count: 1000, capped: true })).toContain(
      "its 1,000+ items",
    );
  });
  it("falls back to the plain text before the count arrives or for an empty folder", () => {
    expect(folderTrashMessage("E", null)).toBe(
      "Move the folder \u201cE\u201d to the Trash? You can restore it from the system Trash.",
    );
    expect(folderTrashMessage("E", { count: 0, capped: false })).toContain(
      "the folder",
    );
  });
});
