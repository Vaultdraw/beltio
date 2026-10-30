/**
 * notes-vim: Vim keys in the note editor, from @replit/codemirror-vim. A
 * separate chunk, fetched only when `notes.vim` is on. `:w` saves the note
 * the cursor is in, and `jk`/`jj` are left to the user's own mappings.
 */
import { Facet } from "@codemirror/state";
import { Vim, vim } from "@replit/codemirror-vim";

import type { EditorView } from "@codemirror/view";

/** Each editor's own save: Vim's `:w` is one global command (toimprove 212). */
const noteSave = Facet.define<() => void, (() => void) | undefined>({
  combine: (saves) => saves[0],
});

let defined = false;

/** The Vim extension; `save` runs for `:w` in this editor. */
export function notesVimExtension(save: () => void) {
  if (!defined) {
    defined = true;
    Vim.defineEx("write", "w", (cm: { cm6?: EditorView }) =>
      cm.cm6?.state.facet(noteSave)?.(),
    );
  }
  return [noteSave.of(save), vim({ status: false })];
}
