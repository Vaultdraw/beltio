const SIZE = /^\s*(\d+)(?:x(\d+))?\s*$/;

/**
 * `alt|300`, `alt|300x200` or a bare `300`: the alt text and the size (Obsidian). Only the part after
 * the last `|` is a size, so "Photo 3" stays alt text. The app's reading view and the plugin API's note parse stand-in use this one
 * function; it is a twin of `altAndSize` in the Markdown import and `alt_and_size` in Rust, and one case table pins all of them
 * (vaultdraw-core/src/markdown/alt_size_cases.json).
 */
export const altAndSize = (
  s: string,
): { alt: string; width?: number; height?: number } => {
  const bar = s.lastIndexOf("|");
  const [alt, last] = bar >= 0 ? [s.slice(0, bar), s.slice(bar + 1)] : ["", s];
  const m = SIZE.exec(last);
  if (!m) {
    return { alt: s.trim() };
  }
  return {
    alt: alt.trim(),
    width: Number(m[1]),
    ...(m[2] ? { height: Number(m[2]) } : {}),
  };
};
