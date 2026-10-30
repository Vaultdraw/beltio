// @vitest-environment jsdom
/**
 * Bug hunter J (2026-10-30 evening) [notes], toimprove 212 (J-5): `:w` in the second note saves the
 * first one. notesVim.ts defines the `:w` command once, with the save callback of the first note
 * editor that turned Vim keys on (`defined` flag); every later editor's `:w` runs that callback.
 * Vim and Obsidian's Vim mode: `:w` writes the buffer the cursor is in. Fixed: each editor
 * carries its own save (a facet), and `:write` reads it from the editor it runs in.
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";
import { expect, it, vi } from "vitest";

import { notesVimExtension } from "./notesVim";

Range.prototype.getClientRects = (() => ({
  length: 0,
  item: () => null,
})) as never;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const editor = (save: () => void) =>
  new EditorView({
    state: EditorState.create({
      doc: "text",
      extensions: [notesVimExtension(save)],
    }),
    parent: document.body,
  });

it(":w saves the note it runs in: the second editor its own, the first its own", () => {
  const saveFirst = vi.fn();
  const saveSecond = vi.fn();
  const first = editor(saveFirst);
  const second = editor(saveSecond);
  Vim.handleEx(getCM(second) as never, "w");
  Vim.handleEx(getCM(first) as never, "write");
  first.destroy();
  second.destroy();
  expect(saveFirst).toHaveBeenCalledTimes(1);
  expect(saveSecond).toHaveBeenCalledTimes(1);
});
