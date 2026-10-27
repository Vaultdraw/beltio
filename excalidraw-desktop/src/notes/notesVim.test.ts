// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";
import { describe, expect, it, vi } from "vitest";

import { notesVimExtension } from "./notesVim";

Range.prototype.getClientRects = (() => ({
  length: 0,
  item: () => null,
})) as never;
Range.prototype.getBoundingClientRect = () => new DOMRect();

describe("notes-vim", () => {
  it("starts in normal mode and :w saves", () => {
    const save = vi.fn();
    const view = new EditorView({
      state: EditorState.create({
        doc: "abc",
        extensions: [notesVimExtension(save)],
      }),
      parent: document.body,
    });
    const cm = getCM(view)!;
    expect(cm.state.vim?.insertMode).toBeFalsy();
    Vim.handleEx(cm, "w");
    expect(save).toHaveBeenCalledTimes(1);
    view.destroy();
  });
});
