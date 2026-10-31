/**
 * Obsidian's basic Markdown editing keys for the note editor (toimprove 280):
 * Enter continues a list, task list or quote (an empty item ends it), and
 * bold / italic toggle their marks around each selection. Plain CodeMirror
 * state commands, no Markdown parser: the note editor's language is a small
 * highlighter (markdownLang.ts), and these need only the current line.
 */
import { EditorSelection } from "@codemirror/state";

import type { EditorState, StateCommand } from "@codemirror/state";

/** indent, marker (`-`, `*`, `+`, `1.`, `1)`, `>`), spacing, task box. */
const ITEM = /^(\s*)(?:([-*+])|(\d{1,9})([.)])|(>))(\s+)(\[[^\]\\\n]\]\s+)?/;
const FENCE = /^\s{0,3}(```|~~~)/;

/** True when line `n` sits inside a fenced code block (lines above it toggle fences). */
const inFence = (state: EditorState, n: number): boolean => {
  let open: string | null = null;
  for (let i = 1; i < n; i++) {
    const m = FENCE.exec(state.doc.line(i).text);
    if (m) {
      open = open === null ? m[1] : open === m[1] ? null : open;
    }
  }
  return open !== null;
};

/**
 * Enter on a list item, task or quote line: a new line with the next marker
 * (numbers count up, a task starts unticked). On an empty item the marker is
 * removed instead, ending the list, as in Obsidian. Anything else (several
 * cursors, a selection, a cursor inside the marker, code blocks) is left to
 * the default Enter.
 */
export const continueMarkup: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  if (state.selection.ranges.length !== 1 || !range.empty) {
    return false;
  }
  const line = state.doc.lineAt(range.head);
  const m = ITEM.exec(line.text);
  if (!m || range.head - line.from < m[0].length) {
    return false;
  }
  if (inFence(state, line.number)) {
    return false;
  }
  const [whole, indent, bullet, num, delim, quote, space, task] = m;
  if (line.text.slice(whole.length).trim() === "") {
    // An empty item: end the list (the line is emptied).
    dispatch(
      state.update({
        changes: { from: line.from, to: line.to, insert: "" },
        selection: EditorSelection.cursor(line.from),
        scrollIntoView: true,
        userEvent: "input",
      }),
    );
    return true;
  }
  const marker = quote ?? bullet ?? `${Number(num) + 1}${delim}`;
  const box = task ? "[ ] " : "";
  const insert = `${state.lineBreak}${indent}${marker}${
    quote ? " " : space
  }${box}`;
  // Text after the cursor moves down with the new item (no trailing spaces left behind).
  let from = range.head;
  while (
    from > line.from + whole.length &&
    line.text[from - line.from - 1] === " "
  ) {
    from--;
  }
  dispatch(
    state.update({
      changes: { from, to: range.head, insert },
      selection: EditorSelection.cursor(from + insert.length),
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
};

const starsBefore = (text: string, at: number): number => {
  let n = 0;
  while (at - n - 1 >= 0 && text[at - n - 1] === "*") {
    n++;
  }
  return n;
};

const starsAfter = (text: string, at: number): number => {
  let n = 0;
  while (at + n < text.length && text[at + n] === "*") {
    n++;
  }
  return n;
};

/** Whether a run of `n` stars on both sides carries the mark (`**` bold, `*` italic). */
const carries = (n: number, mark: string): boolean =>
  mark.length === 2 ? n >= 2 : n % 2 === 1;

/**
 * Toggle `mark` (`**` or `*`) around every selection, as Obsidian's Cmd+B /
 * Cmd+I: wrap the selection (or put the cursor between a new pair), or remove
 * the marks when the selection already sits inside or includes them.
 */
export const toggleMark =
  (mark: "**" | "*"): StateCommand =>
  ({ state, dispatch }) => {
    const size = mark.length;
    const tr = state.changeByRange((range) => {
      const line = state.doc.lineAt(range.from);
      const text = line.text;
      const a = range.from - line.from;
      const b = Math.min(range.to, line.to) - line.from;
      // Marks just outside the selection: `**|word|**`.
      const out = Math.min(starsBefore(text, a), starsAfter(text, b));
      if (!range.empty && carries(out, mark)) {
        return {
          changes: [
            { from: range.from - size, to: range.from },
            { from: range.to, to: range.to + size },
          ],
          range: EditorSelection.range(range.from - size, range.to - size),
        };
      }
      // Marks inside the selection: `|**word**|`.
      const inner = text.slice(a, b);
      const inn = Math.min(
        starsAfter(inner, 0),
        starsBefore(inner, inner.length),
      );
      if (
        !range.empty &&
        range.to <= line.to &&
        inner.length >= 2 * size &&
        carries(inn, mark) &&
        inner.slice(inn).trim() !== ""
      ) {
        return {
          changes: [
            { from: range.from, to: range.from + size },
            { from: range.to - size, to: range.to },
          ],
          range: EditorSelection.range(range.from, range.to - 2 * size),
        };
      }
      return {
        changes: [
          { from: range.from, insert: mark },
          { from: range.to, insert: mark },
        ],
        range: EditorSelection.range(range.from + size, range.to + size),
      };
    });
    dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };
