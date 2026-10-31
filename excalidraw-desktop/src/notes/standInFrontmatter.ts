/**
 * The browser stand-in's front matter reader: a line-by-line port of the native parser
 * (`vaultdraw-core/src/markdown/frontmatter.rs`), pinned to it by the shared case tables
 * `frontmatter_values.json` and `frontmatter_cases.json`. Keep the two in step (toimprove 315, 316).
 */

/** The value without a trailing YAML comment: a `#` that starts the text or follows a space or tab,
 * outside quotes and outside a `[[wikilink]]`. */
export function stripComment(s: string): string {
  let quote: string | null = null;
  let links = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const prev = i === 0 ? "" : s[i - 1];
    if (quote) {
      if (c === "\\" && quote === '"') {
        i++;
      } else if (c === quote) {
        quote = null;
      }
    } else if (
      (c === '"' || c === "'") &&
      (i === 0 || " \t[,".includes(prev))
    ) {
      quote = c;
    } else if (c === "[" && s[i + 1] === "[") {
      links++;
      i++;
    } else if (c === "]" && s[i + 1] === "]" && links > 0) {
      links--;
      i++;
    } else if (
      c === "#" &&
      links === 0 &&
      (i === 0 || prev === " " || prev === "\t")
    ) {
      return s.slice(0, i).trimEnd();
    }
  }
  return s;
}

/** A scalar as YAML reads it: quotes removed, `''` and `\"` and `\\` unescaped. */
export function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replaceAll("''", "'");
  }
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  }
  return s;
}

const splitKey = (line: string): [string, string] | null => {
  const t = line.trimStart();
  if (t.startsWith('"') || t.startsWith("'")) {
    const end = t.indexOf(t[0], 1);
    if (end > 0) {
      const rest = t.slice(end + 1).trimStart();
      if (rest.startsWith(":")) {
        return [t.slice(1, end), rest.slice(1)];
      }
    }
  }
  const i = line.indexOf(":");
  return i < 0 ? null : [line.slice(0, i).trim(), line.slice(i + 1)];
};

export interface StandInFront {
  properties: Record<string, string>;
  tags: string[];
  aliases: string[];
}

export function readFrontmatter(rawText: string): StandInFront {
  const lists = new Map<string, string[]>();
  const scalars = new Map<string, string>();
  const order: string[] = [];
  let cur: string | null = null;
  for (const line of rawText.replaceAll("\r", "").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) {
      continue;
    }
    const indented = /^[ \t]/.test(line);
    if (cur !== null && (indented || t.startsWith("- ") || t === "-")) {
      const item = t.startsWith("- ") ? t.slice(2) : t === "-" ? "" : null;
      if (item !== null) {
        const list = lists.get(cur) ?? [];
        list.push(unquote(stripComment(item.trim())));
        lists.set(cur, list);
      } else {
        const v = scalars.get(cur) ?? "";
        scalars.set(cur, v ? `${v}\n${t}` : t);
      }
      continue;
    }
    const kv = splitKey(line);
    if (!kv || !kv[0]) {
      continue;
    }
    const [key, rest] = kv;
    const val = stripComment(rest.trim());
    if (!order.includes(key)) {
      order.push(key);
    }
    if (
      val.length >= 2 &&
      val.startsWith("[") &&
      !val.startsWith("[[") &&
      val.endsWith("]")
    ) {
      lists.set(
        key,
        val
          .slice(1, -1)
          .split(",")
          .map(unquote)
          .filter((p) => p !== ""),
      );
    } else if (["", "|", ">", "|-", ">-"].includes(val)) {
      if (!scalars.has(key)) {
        scalars.set(key, "");
      }
    } else {
      scalars.set(key, unquote(val));
    }
    cur = key;
  }
  const properties: Record<string, string> = {};
  for (const k of order) {
    const l = lists.get(k);
    properties[k] = l ? l.join(", ") : scalars.get(k) ?? "";
  }
  const get = (names: string[], splitWs: boolean): string[] => {
    const out: string[] = [];
    for (const k of order.filter((o) => names.includes(o.toLowerCase()))) {
      const l = lists.get(k);
      const s = scalars.get(k);
      if (l) {
        out.push(...l);
      } else if (s !== undefined) {
        const parts = splitWs
          ? s.split(/[, \t\n]/)
          : s.includes(",")
          ? s.split(",")
          : [s];
        out.push(...parts.map(unquote));
      }
    }
    return out.filter((s) => s.trim() !== "");
  };
  return {
    properties,
    tags: get(["tags", "tag"], true)
      .map((t) => t.trim().replace(/^#+/, ""))
      .filter(Boolean),
    aliases: get(["aliases", "alias"], false).map((a) => a.trim()),
  };
}
