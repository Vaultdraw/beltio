// @vitest-environment jsdom
/**
 * Bug hunter L (2026-10-30 night) [notes], next door to toimprove 225 (0437d7bb: an embedded
 * note's pictures, wikilinks and embeds resolve from its own folder).
 *
 * L-4: an ordinary Markdown link inside an embedded note (`[index](index.md)`, Obsidian's
 * "relative path" link format, or any vault with Wikilinks off) is resolved from the HOST note's
 * folder: NoteView's onReadingClick calls `resolveRelativeHref(path, …)` with the host's path for
 * every non-wikilink anchor, embedded or not. With `index.md` in both folders the click opens the
 * host folder's index; without one it does nothing. Obsidian follows the link from the note that
 * wrote it.
 *
 * L-5: a `[[link]]` in a property value (e7fe013c, toimprove 230) is drawn as a link; a click on
 * it must open the note, as Obsidian's properties panel does.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { updatePreferences } from "../vault/preferences";

import { FakeNoteFiles } from "./FakeNoteFiles";
import { setNoteFiles } from "./noteBackend";
import NoteView from "./NoteView";

Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.scrollIntoView = () => {};

const vault = {
  handle: "h",
  paths: () =>
    [
      "Inbox/Daily.md",
      "Inbox/index.md",
      "Projects/Plan.md",
      "Projects/index.md",
      "Other.md",
    ] as readonly string[],
};

beforeEach(() => {
  const files = new FakeNoteFiles();
  files.setOnDisk(
    "Inbox/Daily.md",
    "# Daily\n\n[own index](index.md)\n\n![[Plan]]\n",
  );
  files.setOnDisk("Projects/Plan.md", "Plan text.\n\n[plan index](index.md)\n");
  files.setOnDisk("Inbox/index.md", "inbox index");
  files.setOnDisk("Projects/index.md", "projects index");
  files.setOnDisk("Other.md", "other");
  files.setOnDisk("Props.md", '---\nup: "[[Other]]"\n---\n# Props\n');
  setNoteFiles(files);
  updatePreferences({ notesOpenIn: "reading", notesVim: false });
});
afterEach(() => {
  cleanup();
  setNoteFiles(null);
});

const linkIn = async (root: HTMLElement, text: string) => {
  let a: HTMLAnchorElement | undefined;
  await waitFor(() => {
    a = [...root.querySelectorAll("a")].find((x) => x.textContent === text);
    expect(a).toBeDefined();
  });
  return a!;
};

it("sanity: the host note's own Markdown link opens the index next to it", async () => {
  const openPath = vi.fn();
  render(<NoteView path="Inbox/Daily.md" openPath={openPath} vault={vault} />);
  const reading = await screen.findByTestId("note-reading");
  fireEvent.click(await linkIn(reading, "own index"));
  expect(openPath).toHaveBeenCalledWith("Inbox/index.md", expect.anything());
});

it("L-4: a Markdown link inside an embedded note opens the index next to THAT note", async () => {
  const openPath = vi.fn();
  render(<NoteView path="Inbox/Daily.md" openPath={openPath} vault={vault} />);
  const reading = await screen.findByTestId("note-reading");
  const a = await linkIn(reading, "plan index");
  expect(a.closest(".note-embed")).not.toBeNull();
  fireEvent.click(a);
  expect(openPath).toHaveBeenCalledWith("Projects/index.md", expect.anything());
});

it("L-4 family: a [[#Heading]] link inside an embedded note opens the embedded note there", async () => {
  const files = new FakeNoteFiles();
  files.setOnDisk("Inbox/Daily.md", "# Daily\n\n![[Plan]]\n");
  files.setOnDisk(
    "Projects/Plan.md",
    "# Plan\n\n[[#Goals]]\n\n## Goals\n\nx\n",
  );
  setNoteFiles(files);
  const openPath = vi.fn();
  render(<NoteView path="Inbox/Daily.md" openPath={openPath} vault={vault} />);
  const reading = await screen.findByTestId("note-reading");
  const a = await waitFor(() => {
    const x = reading.querySelector<HTMLAnchorElement>(
      ".note-embed a.wikilink",
    );
    expect(x).not.toBeNull();
    return x!;
  });
  fireEvent.click(a);
  expect(openPath).toHaveBeenCalledWith("Projects/Plan.md", expect.anything());
});

it("L-5: a [[link]] in a property opens the note", async () => {
  const openPath = vi.fn();
  render(
    <NoteView
      path="Props.md"
      openPath={openPath}
      vault={{ ...vault, paths: () => ["Props.md", "Other.md"] }}
    />,
  );
  const props = await screen.findByTestId("note-properties");
  const a = props.querySelector("a");
  expect(a).not.toBeNull();
  fireEvent.click(a!);
  expect(openPath).toHaveBeenCalledWith("Other.md", expect.anything());
});
