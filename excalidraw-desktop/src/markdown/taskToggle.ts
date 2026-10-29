/**
 * "Markdown: Toggle task" (Obsidian's Toggle checkbox status): ☐ <-> ☑ on the
 * caret's line of the text being edited, or on the first task line of the one
 * selected text. Pure text edit through the editor's own input path.
 */
import { lineEnd, lineStart, toggledTask } from "./lineRules";

/** `value` with the task on the line at `caret` toggled, or null. */
export function toggleTaskAt(value: string, caret: number): string | null {
  const start = lineStart(value, caret);
  const end = lineEnd(value, caret);
  const toggled = toggledTask(value.slice(start, end));
  return toggled === null
    ? null
    : value.slice(0, start) + toggled + value.slice(end);
}

/** The first task line toggled (a selected text, no caret), or null. */
export function toggleFirstTask(value: string): string | null {
  let start = 0;
  while (start <= value.length) {
    const next = toggleTaskAt(value, start);
    if (next !== null) {
      return next;
    }
    const end = lineEnd(value, start);
    if (end >= value.length) {
      return null;
    }
    start = end + 1;
  }
  return null;
}

/** Toggle in a live editor textarea; true when a task line was toggled. */
export function toggleTaskInTextarea(textarea: HTMLTextAreaElement): boolean {
  const caret = textarea.selectionStart;
  const next = toggleTaskAt(textarea.value, caret);
  if (next === null) {
    return false;
  }
  textarea.value = next;
  textarea.setSelectionRange(caret, caret);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}
