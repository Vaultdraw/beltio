/**
 * Pieces of a note for `![[Note#Heading]]` and `![[Note#^block]]` embeds,
 * found by scanning lines (fenced code is skipped so a `#` comment in code
 * is not a heading).
 */
const FENCE = /^\s{0,3}(```|~~~)/;
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`*_~=]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The heading's line through the line before the next heading of the same or a higher level. */
export function extractSection(text: string, heading: string): string | null {
  const lines = text.split(/\r?\n/);
  const want = norm(heading);
  let fence: string | null = null;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE.exec(line);
    if (f) {
      fence = fence === null ? f[1] : fence === f[1] ? null : fence;
      continue;
    }
    if (fence) {
      continue;
    }
    const h = HEADING.exec(line);
    if (!h) {
      continue;
    }
    if (start < 0) {
      if (norm(h[2]) === want) {
        start = i;
        level = h[1].length;
      }
    } else if (h[1].length <= level) {
      return lines.slice(start, i).join("\n").trimEnd();
    }
  }
  return start < 0 ? null : lines.slice(start).join("\n").trimEnd();
}

/** The paragraph or list item whose last words are `^id`, without the marker. */
export function extractBlock(text: string, id: string): string | null {
  const lines = text.split(/\r?\n/);
  const marker = new RegExp(
    `\\s\\^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
  );
  for (let i = 0; i < lines.length; i++) {
    if (!marker.test(lines[i])) {
      continue;
    }
    let from = i;
    while (
      from > 0 &&
      lines[from - 1].trim() !== "" &&
      !/^\s*([-*+]|\d+[.)])\s/.test(lines[from])
    ) {
      from--;
    }
    const block = lines.slice(from, i + 1);
    block[block.length - 1] = block[block.length - 1].replace(marker, "");
    return block.join("\n");
  }
  return null;
}
