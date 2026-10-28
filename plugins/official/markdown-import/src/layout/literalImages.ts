/**
 * Images the Markdown parser leaves as text. CommonMark does not take spaces in a link target, so
 * `![alt](my pics/a b.png)` reaches the layout as a plain paragraph, and a raw `<img src="…">` as
 * an HTML block; Obsidian draws both as pictures. Pure: text in, pieces out.
 */
export interface LiteralImage {
  kind: "image";
  target: string;
  remote: boolean;
  alt?: string;
  width?: number;
  height?: number;
}

export type Piece = LiteralImage | { kind: "text"; text: string };

const MD_IMAGE = /!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\n]+?)\s*\)/g;
const REMOTE = /^(?:https?:|data:)/i;

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** `alt|300` or `alt|300x200`: the alt text and the size. */
const altAndSize = (s: string) => {
  const m = /^(.*?)\|?\s*(\d+)(?:x(\d+))?$/.exec(s.trim());
  if (!m || (m[1] === "" && !/^\d/.test(s.trim()))) {
    return { alt: s.trim() };
  }
  return {
    alt: m[1].trim(),
    width: Number(m[2]),
    ...(m[3] ? { height: Number(m[3]) } : {}),
  };
};

/** The target without a trailing `"title"` and without `<>`. */
const targetOf = (raw: string): string => {
  let t = raw.trim();
  if (t.startsWith("<") && t.endsWith(">")) {
    return decode(t.slice(1, -1).trim());
  }
  t = t.replace(/\s+(?:"[^"]*"|'[^']*')$/, "");
  return decode(t);
};

const imageOf = (alt: string, raw: string): LiteralImage => {
  const target = targetOf(raw);
  const { alt: a, width, height } = altAndSize(alt);
  return {
    kind: "image",
    target,
    remote: REMOTE.test(target),
    ...(a ? { alt: a } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  };
};

/** The paragraph split at its literal `![alt](target)` images, or null when it has none. */
export const literalImages = (text: string): Piece[] | null => {
  const pieces: Piece[] = [];
  let cursor = 0;
  for (const m of text.matchAll(MD_IMAGE)) {
    // A target without spaces is one the parser already took as an image.
    if (!/\s/.test(targetOf(m[2]))) {
      continue;
    }
    const before = text.slice(cursor, m.index).trim();
    if (before) {
      pieces.push({ kind: "text", text: before });
    }
    pieces.push(imageOf(m[1], m[2]));
    cursor = m.index + m[0].length;
  }
  if (pieces.length === 0) {
    return null;
  }
  const rest = text.slice(cursor).trim();
  if (rest) {
    pieces.push({ kind: "text", text: rest });
  }
  return pieces;
};

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag);
  return m ? m[1] ?? m[2] ?? m[3] : undefined;
};

/** A raw HTML block that is only `<img …>` tags, as images; null for any other HTML. */
export const htmlImages = (html: string): LiteralImage[] | null => {
  const tags = html.match(/<img\b[^>]*>/gi);
  if (!tags || html.replace(/<img\b[^>]*>/gi, "").trim() !== "") {
    return null;
  }
  const out: LiteralImage[] = [];
  for (const tag of tags) {
    const src = attr(tag, "src");
    if (!src) {
      return null;
    }
    const target = decode(src.trim());
    const alt = attr(tag, "alt");
    const w = Number(attr(tag, "width"));
    const h = Number(attr(tag, "height"));
    out.push({
      kind: "image",
      target,
      remote: REMOTE.test(target),
      ...(alt ? { alt } : {}),
      ...(w > 0 ? { width: w } : {}),
      ...(h > 0 ? { height: h } : {}),
    });
  }
  return out;
};
