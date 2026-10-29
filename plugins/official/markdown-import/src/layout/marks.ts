/**
 * Style spans from the parser (`marks`: bold, italic, code) as the layout uses them: a text that
 * is bold from its first to its last word is drawn in the bold variant of the font. Mixed runs
 * inside one sentence are not laid out (see DECISIONS.md of bold-inline: `inline_runs`).
 */
import type { NoteMark } from "@vaultdraw/api";

/** True when every visible character of `text` is inside a bold span (spaces between spans may stay). */
export const wholeBold = (
  text: string,
  marks: readonly NoteMark[] | undefined,
): boolean => {
  if (!marks || marks.length === 0 || !text.trim()) {
    return false;
  }
  const covered = new Uint8Array(text.length);
  let any = false;
  for (const m of marks) {
    if (m.kind === "bold") {
      any = true;
      covered.fill(1, Math.max(0, m.start), Math.min(text.length, m.end));
    }
  }
  if (!any) {
    return false;
  }
  for (let i = 0; i < text.length; i++) {
    if (!covered[i] && !/\s/.test(text[i])) {
      return false;
    }
  }
  return true;
};
