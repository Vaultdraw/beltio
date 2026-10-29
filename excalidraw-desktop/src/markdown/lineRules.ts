/**
 * Markdown typing rules for one line, pure. Called on a typed key with the
 * caret's line only (the text before the caret, or the whole line), never
 * with the whole text.
 */
import type { HeadingLevel } from "./roles";

/** What a typed space turns the line into, or null. */
export type LineTrigger =
  | { kind: "heading"; level: HeadingLevel }
  | { kind: "quote" }
  /** Replace the line's text before the caret with `marker` (+ the space). */
  | { kind: "list"; marker: string };

export const BULLET = "•";
export const TASK_OPEN = "☐";
export const TASK_DONE = "☑";

const BULLET_RE = /^( *)[-*+]$/;
const ORDERED_RE = /^( *)\d{1,9}[.)]$/;
const TASK_RE = /^( *)(?:[-*+•] ?)?\[([ xX]?)\]$/;

/**
 * `before` is the line's text before the caret, without the space being
 * typed. Headings and quotes need the line start (no indent); list markers
 * may be indented (nested lists, Tab).
 */
export function matchLineTrigger(before: string): LineTrigger | null {
  const n = before.length;
  if (n === 0 || n > 24) {
    return null;
  }
  if (before === ">") {
    return { kind: "quote" };
  }
  if (n <= 6 && /^#+$/.test(before)) {
    return { kind: "heading", level: n as HeadingLevel };
  }
  let m = BULLET_RE.exec(before);
  if (m) {
    return { kind: "list", marker: `${m[1]}${BULLET}` };
  }
  m = TASK_RE.exec(before);
  if (m && (m[2] !== "" || before.includes("[]"))) {
    const done = m[2] === "x" || m[2] === "X";
    return { kind: "list", marker: `${m[1]}${done ? TASK_DONE : TASK_OPEN}` };
  }
  if (ORDERED_RE.test(before)) {
    // already reads as a numbered item: only Enter continues it
    return null;
  }
  return null;
}

/** A list item's marker at the start of a line: indent + marker + space. */
export type ListItem = {
  indent: string;
  /** The marker as written, without the trailing space ("•", "3.", "☐"). */
  marker: string;
  /** Length of indent + marker + space: where the item's text starts. */
  length: number;
};

const ITEM_RE = /^( *)(•|☐|☑|\d{1,9}[.)]) /;

export function listItemOf(line: string): ListItem | null {
  const m = ITEM_RE.exec(line);
  return m ? { indent: m[1], marker: m[2], length: m[0].length } : null;
}

/** The marker the next item gets: bullets stay, numbers count up, tasks open. */
export function nextMarker(marker: string): string {
  if (marker === TASK_DONE || marker === TASK_OPEN) {
    return TASK_OPEN;
  }
  const m = /^(\d+)([.)])$/.exec(marker);
  return m ? `${Number(m[1]) + 1}${m[2]}` : marker;
}

/** A task line's marker toggled (☐ <-> ☑), or null for other lines. */
export function toggledTask(line: string): string | null {
  const item = listItemOf(line);
  if (!item || (item.marker !== TASK_OPEN && item.marker !== TASK_DONE)) {
    return null;
  }
  const flipped = item.marker === TASK_OPEN ? TASK_DONE : TASK_OPEN;
  return `${item.indent}${flipped}${line.slice(item.indent.length + 1)}`;
}

/** Start index of the caret's line in `value`. */
export const lineStart = (value: string, caret: number): number =>
  value.lastIndexOf("\n", caret - 1) + 1;

/** End index (exclusive) of the line that starts at or before `from`. */
export const lineEnd = (value: string, from: number): number => {
  const i = value.indexOf("\n", from);
  return i < 0 ? value.length : i;
};

/** Default heading sizes, as multiples of the body text size (as the Markdown import). */
export const DEFAULT_HEADING_SCALES: readonly number[] = [
  2, 1.5, 1.25, 1.125, 1, 1,
];

/** Gap between a block and the next one, in body lines. */
export const DEFAULT_BLOCK_GAP = 0.5;
