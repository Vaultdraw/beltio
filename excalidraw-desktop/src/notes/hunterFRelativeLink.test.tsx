// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { updatePreferences } from "../vault/preferences";

import { FakeNoteFiles } from "./FakeNoteFiles";
import { setNoteFiles } from "./noteBackend";
import NoteView from "./NoteView";

/**
 * Hunter F-17 (2026-10-30). Obsidian vaults that turn "Use [[Wikilinks]]" off write ordinary
 * Markdown links to notes: `[text](Other.md)`, `[text](Folder/Other.md#Heading)`,
 * `[text](My%20Page.md)`. In the reading view only `[[wikilinks]]` (class "wikilink") and http(s)
 * links (data-external) have a click handler (`NoteView.tsx onReadingClick`); a plain relative
 * `<a href="Other.md">` is left to the browser, which navigates the app's own window to that
 * address (there is no navigation guard in the page or in the Tauri shell). Obsidian opens the
 * note.
 */
const NOTE = "[rel](Other.md) and [enc](My%20Page.md)\n";
let files: FakeNoteFiles;
const vault = {
  handle: "h",
  paths: () => ["n.md", "Other.md", "My Page.md"] as readonly string[],
};

const emptyRects = () => ({
  length: 0,
  item: () => null,
  [Symbol.iterator]: [][Symbol.iterator],
});
Range.prototype.getClientRects = emptyRects as never;
Range.prototype.getBoundingClientRect = () => new DOMRect();

beforeEach(() => {
  files = new FakeNoteFiles();
  files.setOnDisk("n.md", NOTE);
  files.setOnDisk("Other.md", "other");
  files.setOnDisk("My Page.md", "page");
  setNoteFiles(files);
  updatePreferences({
    notesOpenIn: "reading",
    notesAutosaveMs: 20,
    notesVim: false,
  });
});
afterEach(() => {
  cleanup();
  setNoteFiles(null);
});

describe("hunter F-17: a Markdown link to a note in the reading view", () => {
  it.fails("opens the note and never lets the window navigate", async () => {
    const open = vi.fn();
    render(<NoteView path="n.md" openPath={open} vault={vault} />);
    await screen.findByTestId("note-reading");
    const link = screen.getByText("rel");
    expect(link.getAttribute("href")).toBe("Other.md");
    const navigated = fireEvent.click(link); // false when the handler prevented the default
    expect(navigated).toBe(false);
    expect(open).toHaveBeenLastCalledWith("Other.md", { target: "current" });
  });
  it.fails("the same for a percent-encoded name", async () => {
    const open = vi.fn();
    render(<NoteView path="n.md" openPath={open} vault={vault} />);
    await screen.findByTestId("note-reading");
    fireEvent.click(screen.getByText("enc"));
    expect(open).toHaveBeenLastCalledWith("My Page.md", { target: "current" });
  });
});
