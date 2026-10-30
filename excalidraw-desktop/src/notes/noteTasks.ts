/**
 * Task checkboxes (`- [ ] item`) of a note's source, so the reading view can
 * tick one: the Nth checkbox of the rendered page is the Nth task line here.
 * Positions come from the renderer's own tokens, so code (fenced or indented), HTML comments,
 * math blocks and front matter are skipped exactly as it skips them.
 */
import { lexNote } from "./render/obsidian";

import type { Token, Tokens } from "marked";

/** Any one status character, as Obsidian (`[/]`, `[-]`, `[>]`): ticking one clears it. */
const TASK =
  /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([^\]\\\n])(\])(?=[ \t]|$)/;

const newlines = (s: string) => (s.match(/\n/g) ?? []).length;

/**
 * Task lines among `tokens`, which start on line `base`. Lines are counted from each token's own
 * raw text, so a quote, a list item or an indented block never shifts the count.
 */
function collect(tokens: Token[], base: number, out: number[]): void {
  let line = base;
  for (const t of tokens) {
    if (t.type === "list") {
      let at = line;
      for (const item of (t as Tokens.List).items) {
        if (item.task) {
          out.push(at);
        }
        collect(item.tokens, at, out);
        at += newlines(item.raw);
      }
    } else if (t.type === "blockquote") {
      collect((t as Tokens.Blockquote).tokens, line, out);
    }
    line += newlines(t.raw);
  }
}

/**
 * Line numbers (0-based) of the note's task items, in reading order: the ones the reading view
 * draws a checkbox for. `math` is the renderer's math setting (a `$$` block hides what is inside).
 */
export function taskLines(text: string, math = true): number[] {
  const { tokens, skipped } = lexNote(text, math);
  const out: number[] = [];
  collect(tokens, skipped, out);
  return out;
}

/** `text` with task number `index` ticked or unticked; null when there is no such task. */
export function toggleTask(
  text: string,
  index: number,
  math = true,
): string | null {
  const at = taskLines(text, math)[index];
  if (at === undefined) {
    return null;
  }
  const lines = text.split("\n");
  if (!TASK.test(lines[at])) {
    return null;
  }
  lines[at] = lines[at].replace(
    TASK,
    (_m, a: string, mark: string, b: string) =>
      `${a}${mark === " " ? "x" : " "}${b}`,
  );
  return lines.join("\n");
}
