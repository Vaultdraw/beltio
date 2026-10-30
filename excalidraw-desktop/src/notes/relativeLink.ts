import { joinRelative } from "../links/resolve";

/**
 * Where an ordinary Markdown link in a note points: `[t](Other.md)`, `(My%20Page.md)`,
 * `(Folder/Other.md#Heading)`, `(../x.excalidraw)`. Obsidian vaults with "Use [[Wikilinks]]" off
 * write these. Null when it is not a link to a vault file (web address, `mailto:`, no such file).
 */
export const resolveRelativeHref = (
  from: string,
  href: string,
  paths: readonly string[],
): { path: string; heading: string | null } | null => {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
    return null;
  }
  const hash = href.indexOf("#");
  const rawPath = hash >= 0 ? href.slice(0, hash) : href;
  const rawHeading = hash >= 0 ? href.slice(hash + 1) : "";
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const heading = rawHeading ? decode(rawHeading) : null;
  if (!rawPath) {
    return { path: from, heading };
  }
  const rel = decode(rawPath);
  const folder = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  const joined = rel.startsWith("/")
    ? joinRelative("", rel)
    : joinRelative(folder, rel);
  if (joined === null) {
    return null;
  }
  const lower = joined.toLowerCase();
  const found =
    paths.find((p) => p === joined) ??
    paths.find((p) => p.toLowerCase() === lower);
  return found ? { path: found, heading } : null;
};
