/**
 * notes-vim: Vim keys in the note editor, from @replit/codemirror-vim. A
 * separate chunk, fetched only when `notes.vim` is on. `:w` saves the note,
 * and `jk`/`jj` are left to the user's own mappings.
 */
import { Vim, vim } from "@replit/codemirror-vim";

let defined = false;

/** The Vim extension; `save` runs for `:w`. */
export function notesVimExtension(save: () => void) {
  if (!defined) {
    defined = true;
    Vim.defineEx("write", "w", () => save());
  }
  return vim({ status: false });
}
