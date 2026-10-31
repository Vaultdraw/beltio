/**
 * The id a heading gets in the reading view, and the one `[[Note#Heading]]` looks for: one copy for
 * the renderer and the anchor finder. A slug that would read `fn-1` or `fnref-1` is written with an
 * `h-` in front, so a heading never takes a footnote's id and its click (toimprove 309).
 */
export const headingSlug = (s: string): string => {
  const k = s
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
  return /^fn(?:ref)?-/.test(k) ? `h-${k}` : k;
};
