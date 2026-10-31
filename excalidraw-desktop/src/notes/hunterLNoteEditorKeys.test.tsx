// @vitest-environment jsdom
/**
 * Hunter L (2026-10-30 night) [notes] [improvement] L-12: the note editor's keyboard against
 * Obsidian's editor defaults. NoteEditor.tsx builds its keymap from Mod-s, indentWithTab,
 * defaultKeymap and historyKeymap only (markdownSupport is a highlighter, no Markdown keymap; no
 * search). So in the note editor:
 * - Enter at the end of a list item does not start the next item (Obsidian: `- ` continues, an
 *   empty item ends the list; our own canvas Markdown mode does this too).
 * - Cmd+B / Cmd+I do nothing (Obsidian: bold / italic the selection; the canvas has Cmd+B).
 * - Cmd+F does nothing (Obsidian: find in the note; Neovim `/` only with Vim keys on).
 * Each row presses the key through the editor's own keymap (runScopeHandlers; jsdom is not a
 * Mac, so Mod is Ctrl here).
 * Fixed (toimprove 280): Enter is in the editor's keymap; Cmd+B / Cmd+I / Cmd+F are the
 * rebindable commands Notes: Bold / Italic / Find in note, which run the editor handle's
 * actions (the window dispatcher claims the key before CodeMirror sees it).
 */
import { cleanup, render } from "@testing-library/react";
import { EditorSelection } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import NoteEditor from "./NoteEditor";
import { NOTES_COMMANDS } from "./notesCommands";

import type { NoteEditorHandle } from "./NoteEditor";

Range.prototype.getClientRects = (() => ({
  length: 0,
  item: () => null,
})) as never;
Range.prototype.getBoundingClientRect = () => new DOMRect();

afterEach(cleanup);

const editor = (doc: string) => {
  let handle: NoteEditorHandle | null = null;
  const { container } = render(
    <NoteEditor
      initial={doc}
      vim={false}
      lineWrap
      lineNumbers={false}
      fontSize={16}
      onChange={() => {}}
      onSave={() => {}}
      onReady={(h) => {
        handle = h;
      }}
    />,
  );
  const view = EditorView.findFromDOM(
    container.querySelector(".cm-editor") as HTMLElement,
  )!;
  const press = (key: string, mods: KeyboardEventInit = {}) =>
    runScopeHandlers(
      view,
      new KeyboardEvent("keydown", { key, ...mods }),
      "editor",
    );
  return {
    view,
    press,
    run: (a: "bold" | "italic" | "find") => handle!.run(a),
  };
};

describe("hunter L-12: note editor keys (Obsidian's defaults)", () => {
  it("sanity: Cmd+Z undoes typing (historyKeymap is there)", () => {
    const { view, press } = editor("a");
    view.dispatch({ changes: { from: 1, insert: "b" } });
    expect(press("z", { ctrlKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe("a");
  });

  it("Enter at the end of a list item starts the next item", () => {
    const { view, press } = editor("- milk");
    view.dispatch({ selection: EditorSelection.cursor(6) });
    press("Enter");
    expect(view.state.doc.toString()).toBe("- milk\n- ");
  });

  it("Cmd+B (Notes: Bold) makes the selection bold", () => {
    const { view, run } = editor("say word");
    view.dispatch({ selection: EditorSelection.range(4, 8) });
    run("bold");
    expect(view.state.doc.toString()).toBe("say **word**");
  });

  it("Cmd+F (Notes: Find in note) opens find in the note", async () => {
    const { view, run } = editor("text");
    run("find");
    await vi.waitFor(() =>
      expect(view.dom.querySelector(".cm-search")).not.toBeNull(),
    );
  });

  it("the three are rebindable note commands on Obsidian's keys, only while editing", () => {
    const keys = Object.fromEntries(
      NOTES_COMMANDS.map((c) => [c.id, c.keys.default]),
    );
    expect(keys["notes.bold"]).toEqual(["Mod+B"]);
    expect(keys["notes.italic"]).toEqual(["Mod+I"]);
    expect(keys["notes.find"]).toEqual(["Mod+F"]);
    for (const id of ["notes.bold", "notes.italic", "notes.find"]) {
      expect(NOTES_COMMANDS.find((c) => c.id === id)!.when).toContain(
        "notes.editing",
      );
    }
  });
});
