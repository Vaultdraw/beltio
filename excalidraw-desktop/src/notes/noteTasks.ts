/**
 * Task checkboxes (`- [ ] item`) of a note's source, so the reading view can
 * tick one: the Nth checkbox of the rendered page is the Nth task line here.
 * Fenced code and front matter are skipped, as the renderer skips them.
 */
const FENCE = /^\s{0,3}(```|~~~)/;
const TASK =
  /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])(\])(?=[ \t]|$)/;
const FRONTMATTER =
  /^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** Line numbers (0-based) of the note's task items, in reading order. */
export function taskLines(text: string): number[] {
  const fm = FRONTMATTER.exec(text)?.[0] ?? "";
  const skip = fm ? fm.replace(/\r?\n$/, "").split("\n").length : 0;
  const lines = text.split("\n");
  const out: number[] = [];
  let fence: string | null = null;
  for (let i = skip; i < lines.length; i++) {
    const f = FENCE.exec(lines[i]);
    if (f) {
      fence = fence === null ? f[1] : fence === f[1] ? null : fence;
      continue;
    }
    if (!fence && TASK.test(lines[i])) {
      out.push(i);
    }
  }
  return out;
}

/** `text` with task number `index` ticked or unticked; null when there is no such task. */
export function toggleTask(text: string, index: number): string | null {
  const at = taskLines(text)[index];
  if (at === undefined) {
    return null;
  }
  const lines = text.split("\n");
  lines[at] = lines[at].replace(
    TASK,
    (_m, a: string, mark: string, b: string) =>
      `${a}${mark === " " ? "x" : " "}${b}`,
  );
  return lines.join("\n");
}
