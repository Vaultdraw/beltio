/**
 * The next free name, like Obsidian ("Untitled", "Untitled 1", "Untitled 2")
 * and Finder. One helper for every generated name (new drawing, template
 * drawing, new folder), so none of them can clash with an existing entry.
 * Names compare case-insensitively (macOS and Windows file systems).
 */
export function uniqueName(
  base: string,
  extension: string,
  taken: Iterable<string>,
): string {
  const used = new Set<string>();
  for (const name of taken) {
    used.add(name.toLowerCase());
  }
  let candidate = `${base}${extension}`;
  for (let n = 1; used.has(candidate.toLowerCase()); n++) {
    candidate = `${base} ${n}${extension}`;
  }
  return candidate;
}
