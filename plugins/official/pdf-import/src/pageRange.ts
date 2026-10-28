/** "all", "1-5, 8, 10-" -> 0-based sorted unique page indices. */
export const parsePageRange = (
  text: string,
  pageCount: number,
): { pages: number[] } | { error: string } => {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "" || trimmed === "all") {
    return { pages: Array.from({ length: pageCount }, (_, i) => i) };
  }
  const set = new Set<number>();
  for (const raw of trimmed.split(",")) {
    const part = raw.trim();
    const m = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(part);
    if (!part || !m || (!m[1] && !m[3])) {
      return { error: `Invalid page range "${part}"` };
    }
    const hasDash = Boolean(m[2]);
    let from: number;
    let to: number;
    if (!hasDash) {
      if (m[3]) {
        return { error: `Invalid page range "${part}"` };
      }
      from = to = Number(m[1]);
    } else {
      if (!m[1]) {
        return { error: `Invalid page range "${part}"` };
      }
      from = Number(m[1]);
      to = m[3] ? Number(m[3]) : pageCount;
    }
    if (from < 1 || to < 1) {
      return { error: "Pages start at 1" };
    }
    if (from > pageCount || to > pageCount) {
      return { error: `The document has ${pageCount} pages` };
    }
    if (from > to) {
      return { error: `Range "${part}" is backwards` };
    }
    for (let p = from; p <= to; p++) {
      set.add(p - 1);
    }
  }
  return { pages: [...set].sort((a, b) => a - b) };
};
