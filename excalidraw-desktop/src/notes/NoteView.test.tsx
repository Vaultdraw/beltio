// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRegisteredHandler } from "../commands/handlerRegistry";
import { readCustomContextKey } from "../commands/contextKeys";

import { updatePreferences } from "../vault/preferences";

import { FakeNoteFiles } from "./FakeNoteFiles";
import { setNoteFiles } from "./noteFiles";
import NoteView from "./NoteView";
import { NOTES_ACTIVE_KEY, NOTES_COMMAND_IDS } from "./notesCommands";

const NOTE = `---
status: draft
tags: [idea]
---
# Title

Hello **world** with [[Other]] and [[Ghost]] #later

> [!tip] Hint
> be quick

\`\`\`ts
const a = 1
\`\`\`
`;

let files: FakeNoteFiles;
const vault = {
  handle: "h",
  paths: () => ["n.md", "Other.md"] as readonly string[],
};

// jsdom has no layout: CodeMirror measures ranges.
const emptyRects = () => ({
  length: 0,
  item: () => null,
  [Symbol.iterator]: [][Symbol.iterator],
});
Range.prototype.getClientRects = emptyRects as never;
Range.prototype.getBoundingClientRect = () => new DOMRect();

beforeEach(() => {
  files = new FakeNoteFiles({ "n.md": NOTE, "Other.md": "other" });
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

const mount = (openPath = vi.fn()) => {
  render(<NoteView path="n.md" openPath={openPath} vault={vault} />);
  return openPath;
};

describe("NoteView", () => {
  it("renders the note: properties, formatting, callout, code, tags", async () => {
    mount();
    const reading = await screen.findByTestId("note-reading");
    expect(reading.querySelector("h1")?.textContent).toBe("Title");
    expect(reading.querySelector("strong")?.textContent).toBe("world");
    expect(reading.querySelector('[data-callout="tip"]')).toBeTruthy();
    expect(reading.querySelector(".tok-keyword")?.textContent).toBe("const");
    await waitFor(() =>
      expect(screen.getByTestId("note-properties").textContent).toContain(
        "draft",
      ),
    );
    expect(reading.textContent).toContain("#idea");
  });

  it("a [[link]] opens its note, with the modifier in a new tab; a missing one is created", async () => {
    const open = mount();
    await screen.findByTestId("note-reading");
    fireEvent.click(screen.getByText("Other"));
    expect(open).toHaveBeenLastCalledWith("Other.md", { target: "current" });
    fireEvent.click(screen.getByText("Other"), { metaKey: true });
    expect(open).toHaveBeenLastCalledWith("Other.md", { target: "new" });
    fireEvent.click(screen.getByText("Ghost"));
    await waitFor(() =>
      expect(open).toHaveBeenLastCalledWith("Ghost.md", { target: "current" }),
    );
    expect(files.text("Ghost.md")).toBe("");
  });

  it("edits and saves through the guarded write, then reads back", async () => {
    mount();
    await screen.findByTestId("note-reading");
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    const content = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".cm-content");
      if (!el) {
        throw new Error("editor not mounted");
      }
      return el;
    });
    const view = EditorView.findFromDOM(
      content.closest(".cm-editor") as HTMLElement,
    )!;
    expect(view.state.doc.toString()).toBe(NOTE);
    act(() => {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: "More text\n" },
      });
    });
    await waitFor(() => expect(files.text("n.md")).toBe(`${NOTE}More text\n`));
    await waitFor(() =>
      expect(screen.getByTestId("note-status").dataset.status).toBe("saved"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show reading view" }));
    expect((await screen.findByTestId("note-reading")).textContent).toContain(
      "More text",
    );
  });

  it("a change on disk while editing shows the conflict and keeps the disk version", async () => {
    mount();
    await screen.findByTestId("note-reading");
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    const content = await waitFor(
      () => document.querySelector<HTMLElement>(".cm-content")!,
    );
    const view = EditorView.findFromDOM(
      content.closest(".cm-editor") as HTMLElement,
    )!;
    files.externalWrite("n.md", "changed elsewhere");
    act(() => {
      view.dispatch({ changes: { from: 0, insert: "mine " } });
    });
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /changed on disk/i,
    );
    expect(files.text("n.md")).toBe("changed elsewhere");
    fireEvent.click(screen.getByRole("button", { name: "Reload from disk" }));
    await waitFor(() =>
      expect(view.state.doc.toString()).toBe("changed elsewhere"),
    );
    expect(files.text("n.md")).toBe("changed elsewhere");
  });

  it("binds its commands while mounted and only then", async () => {
    expect(getRegisteredHandler(NOTES_COMMAND_IDS.toggleEdit)).toBeUndefined();
    expect(readCustomContextKey(NOTES_ACTIVE_KEY)).toBe(false);
    mount();
    await screen.findByTestId("note-reading");
    expect(readCustomContextKey(NOTES_ACTIVE_KEY)).toBe(true);
    act(() => void getRegisteredHandler(NOTES_COMMAND_IDS.toggleEdit)?.());
    await waitFor(() =>
      expect(document.querySelector(".cm-content")).toBeTruthy(),
    );
    cleanup();
    expect(getRegisteredHandler(NOTES_COMMAND_IDS.toggleEdit)).toBeUndefined();
    expect(readCustomContextKey(NOTES_ACTIVE_KEY)).toBe(false);
  });

  it("shows an error and retries when the note cannot be read", async () => {
    files.files.delete("n.md");
    mount();
    expect(await screen.findByRole("alert")).toBeTruthy();
    files.externalWrite("n.md", "back");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByTestId("note-reading")).textContent).toContain(
      "back",
    );
  });

  it("opens in the editor when notes.open_in says so", async () => {
    updatePreferences({ notesOpenIn: "editing" });
    mount();
    await waitFor(() =>
      expect(document.querySelector(".cm-content")).toBeTruthy(),
    );
    expect(screen.queryByTestId("note-reading")).toBeNull();
  });
});
