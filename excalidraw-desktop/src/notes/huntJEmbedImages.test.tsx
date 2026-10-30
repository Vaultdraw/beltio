// @vitest-environment jsdom
/**
 * Bug hunter J (2026-10-30 evening) [notes], toimprove 225 (J-12): a picture inside an embedded
 * note never loads. NoteView hands each `img[src]` with a vault path (`![](pics/a.png)`) to the
 * asset loader (it removes `src` and sets a blob address) once, on the note's own body; the
 * `![[Other]]` embed is filled later (hydrateEmbeds → afterNested), and afterNested runs math,
 * embeds and web pictures but not vault pictures, so the embedded `<img src="pics/a.png">` stays a
 * broken relative address. Obsidian shows the embedded note's pictures.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";

import { updatePreferences } from "../vault/preferences";

import { FakeNoteFiles } from "./FakeNoteFiles";
import { setNoteFiles } from "./noteBackend";
import NoteView from "./NoteView";

Range.prototype.getBoundingClientRect = () => new DOMRect();

const vault = {
  handle: "h",
  paths: () =>
    ["Host.md", "Other.md", "Props.md", "pics/a.png"] as readonly string[],
};

beforeEach(() => {
  const files = new FakeNoteFiles();
  files.setOnDisk("Host.md", "# Host\n\n![own](pics/a.png)\n\n![[Other]]\n");
  files.setOnDisk("Other.md", "Embedded text.\n\n![inner](pics/a.png)\n");
  files.setOnDisk(
    "Props.md",
    '---\nup: "[[Other]]"\nstatus: draft\n---\n# Props\n',
  );
  setNoteFiles(files);
  updatePreferences({ notesOpenIn: "reading", notesVim: false });
});
afterEach(() => {
  cleanup();
  setNoteFiles(null);
});

it("sanity: the note's own vault picture goes to the asset loader", async () => {
  render(<NoteView path="Host.md" openPath={() => {}} vault={vault} />);
  const reading = await screen.findByTestId("note-reading");
  await waitFor(() =>
    expect(
      reading.querySelector('img[alt="own"]')?.getAttribute("src"),
    ).toBeNull(),
  );
});

it("a vault picture inside an embedded note goes to the asset loader too", async () => {
  render(<NoteView path="Host.md" openPath={() => {}} vault={vault} />);
  const reading = await screen.findByTestId("note-reading");
  await waitFor(() =>
    expect(reading.querySelector(".note-embed-body")).not.toBeNull(),
  );
  const inner = reading.querySelector('.note-embed-body img[alt="inner"]');
  expect(inner).not.toBeNull();
  expect(inner!.getAttribute("src")).toBeNull();
});

// J-14 (toimprove 230): a [[link]] in a property value is a link in Obsidian's properties panel.
it("sanity: properties are listed", async () => {
  render(<NoteView path="Props.md" openPath={() => {}} vault={vault} />);
  const props = await screen.findByTestId("note-properties");
  expect(props.textContent).toContain("draft");
});

it("a [[link]] in a property value is a link to the note", async () => {
  render(<NoteView path="Props.md" openPath={() => {}} vault={vault} />);
  const props = await screen.findByTestId("note-properties");
  expect(props.querySelector("a")).not.toBeNull();
  expect(props.textContent).not.toContain("[[");
});

it("a web address in a property is a link; other text stays text", async () => {
  const files = new FakeNoteFiles();
  files.setOnDisk(
    "Props.md",
    '---\nsource: "see https://example.com/a. **not bold**"\n---\n# P\n',
  );
  setNoteFiles(files);
  render(<NoteView path="Props.md" openPath={() => {}} vault={vault} />);
  const props = await screen.findByTestId("note-properties");
  expect(props.querySelector("a")?.getAttribute("href")).toBe(
    "https://example.com/a",
  );
  expect(props.querySelector("strong")).toBeNull();
  expect(props.textContent).toContain("**not bold**");
});
