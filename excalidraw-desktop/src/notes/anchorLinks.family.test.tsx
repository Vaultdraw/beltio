// @vitest-environment jsdom
/**
 * Family "every link form that carries an anchor queues it": `[[Note#Heading]]`, `[[Note#^id]]`,
 * `[t](Note.md#Heading)`, `[t](Note.md#^id)` and `[t](#^id)` (the form Obsidian writes for a block
 * link when Wikilinks are off). The click must hand the note view `{ heading }` or `{ block }`
 * for the right target. `it.fails` rows turn red when fixed (toimprove 324).
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { updatePreferences } from "../vault/preferences";

import { FakeNoteFiles } from "./FakeNoteFiles";
import { setNoteFiles } from "./noteBackend";
import { takeAnchor, type NoteAnchor } from "./noteAnchor";
import NoteView from "./NoteView";

Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.scrollIntoView = () => {};

const vault = {
  handle: "h",
  paths: () => ["n.md", "Other.md"] as readonly string[],
};

let files: FakeNoteFiles;
beforeEach(() => {
  files = new FakeNoteFiles();
  files.setOnDisk("Other.md", "# Part One\n\nA paragraph ^blk\n");
  setNoteFiles(files);
  updatePreferences({ notesOpenIn: "reading", notesVim: false });
});
afterEach(() => {
  cleanup();
  setNoteFiles(null);
});

const rows: {
  name: string;
  md: string;
  label: string;
  opens: string;
  anchor: NoteAnchor;
  broken?: boolean;
}[] = [
  {
    name: "wikilink to a heading",
    md: "[[Other#Part One]]",
    label: "Other > Part One",
    opens: "Other.md",
    anchor: { heading: "Part One" },
  },
  {
    name: "wikilink to a block",
    md: "[[Other#^blk]]",
    label: "Other > ^blk",
    opens: "Other.md",
    anchor: { block: "blk" },
  },
  {
    name: "markdown link to a heading",
    md: "[go](Other.md#Part%20One)",
    label: "go",
    opens: "Other.md",
    anchor: { heading: "Part One" },
  },
  {
    name: "markdown link to a block",
    md: "[go](Other.md#^blk)",
    label: "go",
    opens: "Other.md",
    anchor: { block: "blk" },
    broken: true,
  },
];

type Row = typeof rows[number];

const click = async (r: Row) => {
  const openPath = vi.fn();
  files.setOnDisk("n.md", r.md);
  render(<NoteView path="n.md" openPath={openPath} vault={vault} />);
  const reading = await screen.findByTestId("note-reading");
  let a: HTMLAnchorElement | undefined;
  await waitFor(() => {
    a = [...reading.querySelectorAll("a")].find(
      (x) => x.textContent === r.label,
    );
    expect(a).toBeDefined();
  });
  fireEvent.click(a!);
  expect(openPath).toHaveBeenCalledWith(r.opens, expect.anything());
  expect(takeAnchor(r.opens)).toEqual(r.anchor);
};

describe("a click on a link with an anchor queues the anchor", () => {
  for (const r of rows) {
    (r.broken ? it.fails : it)(r.name, () => click(r));
  }
});
