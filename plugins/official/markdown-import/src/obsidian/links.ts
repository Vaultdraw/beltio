/**
 * Obsidian links → Vaultdraw drawing links.
 *
 * Obsidian resolves `[[Name]]` by the shortest unique path, case-insensitively, with or without
 * the extension; `[[folder/Name]]` by path suffix. Vaultdraw's text-link grammar is
 * `[[target]]` / `[[target|label]]` on one line (256 chars, no `[` or `]` inside), resolved by
 * exact path, then unique basename, then shortest path (vaultdraw-core links/index.rs), with no
 * `#heading` or `#^block` fragments. So every wikilink is rewritten to the converted drawing's
 * path, keeping the written form (or the alias) as the label when it differs:
 *
 * | Obsidian                       | Vaultdraw                                  |
 * | ------------------------------ | ------------------------------------------ |
 * | `[[Note]]`                     | `[[Note]]` (or `[[folder/Note]]` when nested) |
 * | `[[Note\|alias]]`              | `[[folder/Note\|alias]]`                   |
 * | `[[Note#Heading]]`             | `[[folder/Note\|Note#Heading]]`            |
 * | `[[Sketch.excalidraw]]`        | `[[Drawings/Sketch]]` (the converted drawing) |
 * | unresolved                     | unchanged text                              |
 *
 * `![[image.png]]` embeds are image blocks, resolved the same way to an attachment.
 */
import type { NoteBlock, NoteDoc, NoteInline } from "@vaultdraw/api";
import type { ItemKind, PlanItem } from "./plan";

/** Vaultdraw's limit on the text between the brackets. */
const MAX_BODY_CHARS = 256;

export interface Resolved {
  kind: ItemKind;
  /** Source path. */
  path: string;
  /** Target path in the import (drawings end in `.excalidraw`). */
  target: string;
}

/** Case- and accent-insensitive key: NFC, lower case, whitespace collapsed. */
const fold = (s: string): string =>
  s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

const stripNoteExt = (s: string): string => s.replace(/\.(md|markdown)$/i, "");

/** Candidate keys of a link target: as written, without `.md`, without `.excalidraw`. */
const keysOfTarget = (written: string): string[] => {
  const t = fold(written.replace(/^\/+/, ""));
  const keys = [t];
  const noMd = stripNoteExt(t);
  if (noMd !== t) {
    keys.push(noMd);
  }
  return keys;
};

interface Candidate {
  item: Resolved;
  /** Folded source path without the note extension. */
  key: string;
  base: string;
}

/**
 * The source file index, Obsidian style: by basename (no extension) and by full path.
 * A `.excalidraw.md` drawing answers to `Sketch`, `Sketch.excalidraw` and its path forms.
 */
export class LinkResolver {
  private readonly byBase = new Map<string, Candidate[]>();
  private readonly byPath = new Map<string, Candidate>();

  constructor(items: readonly PlanItem[]) {
    for (const item of items) {
      const names = this.namesOf(item);
      for (const name of names) {
        const c: Candidate = {
          item,
          key: name,
          base: name.slice(name.lastIndexOf("/") + 1),
        };
        this.byPath.set(name, c);
        const list = this.byBase.get(c.base) ?? [];
        list.push(c);
        this.byBase.set(c.base, list);
      }
    }
  }

  /** The folded path forms a file answers to. */
  private namesOf(item: PlanItem): string[] {
    const full = fold(item.path);
    switch (item.kind) {
      case "note":
        return [stripNoteExt(full)];
      case "excalidrawMd": {
        const noMd = stripNoteExt(full); // a/sketch.excalidraw
        return [noMd, noMd.replace(/\.excalidraw$/, "")];
      }
      default:
        return [full];
    }
  }

  /**
   * Obsidian's rule: exact path, else the unique or shortest path with that basename.
   * With `fromDir` (the note's folder), `./x`, `../x` and plain `x` are tried from that folder first.
   */
  resolve(
    written: string,
    kinds?: readonly ItemKind[],
    fromDir?: string,
  ): Resolved | null {
    if (fromDir !== undefined) {
      const rel = relativeTo(fromDir, written);
      const hit = rel === null ? undefined : this.byPath.get(fold(rel));
      if (hit && (!kinds || kinds.includes(hit.item.kind))) {
        return hit.item;
      }
      // `../x` or `./x` that did not land on a file: the name alone is what Obsidian falls back to.
      if (/^\.{1,2}\//.test(written)) {
        return this.resolve(
          written.replace(/^(?:\.{1,2}\/)+/, ""),
          kinds,
          fromDir,
        );
      }
    }
    const near = fromDir === undefined ? [] : fold(fromDir).split("/");
    for (const key of keysOfTarget(written)) {
      const exact = this.byPath.get(key);
      if (exact && (!kinds || kinds.includes(exact.item.kind))) {
        return exact.item;
      }
      const base = key.slice(key.lastIndexOf("/") + 1);
      const hasSlash = key.includes("/");
      let best: Candidate | null = null;
      for (const c of this.byBase.get(base) ?? []) {
        if (kinds && !kinds.includes(c.item.kind)) {
          continue;
        }
        if (hasSlash && !c.key.endsWith(`/${key}`)) {
          continue;
        }
        if (!best || closer(c, best, near)) {
          best = c;
        }
      }
      if (best) {
        return best.item;
      }
    }
    return null;
  }
}

/** Leading folders a candidate shares with the note's folder. */
const shared = (c: Candidate, near: readonly string[]): number => {
  const dirs = c.key.split("/").slice(0, -1);
  let n = 0;
  while (n < dirs.length && n < near.length && dirs[n] === near[n]) {
    n++;
  }
  return n;
};

/** Obsidian's pick among files with one name: the nearest to the note, then the shortest path. */
const closer = (
  a: Candidate,
  b: Candidate,
  near: readonly string[],
): boolean => {
  const sa = shared(a, near);
  const sb = shared(b, near);
  if (sa !== sb) {
    return sa > sb;
  }
  return (
    a.key.length < b.key.length ||
    (a.key.length === b.key.length && a.key < b.key)
  );
};

/** `written` resolved against the folder `dir` (`..` and `.` applied), or null when it leaves the vault. */
export const relativeTo = (dir: string, written: string): string | null => {
  const parts = written.startsWith("/") ? [] : dir.split("/").filter(Boolean);
  for (const part of written.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      if (parts.pop() === undefined) {
        return null;
      }
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
};

/** The target path without `.excalidraw`: what a Vaultdraw link names. */
const linkTarget = (target: string): string =>
  target.replace(/\.excalidraw$/i, "");

/** The written form of a wikilink's reference (target plus fragments, no alias). */
const writtenOf = (span: NoteInline): string =>
  span.target +
  (span.heading ? `#${span.heading}` : "") +
  (span.blockRef ? `#^${span.blockRef}` : "");

/** `[[target|label]]` as Vaultdraw reads it, or null when the grammar would refuse it. */
export const drawingLink = (target: string, label?: string): string | null => {
  const body =
    label !== undefined && label !== target ? `${target}|${label}` : target;
  if (
    body.length > MAX_BODY_CHARS ||
    /[[\]\r\n]/.test(body) ||
    target.trim() === ""
  ) {
    return null;
  }
  return `[[${body}]]`;
};

export interface RewriteStats {
  rewritten: number;
  unresolved: number;
}

/**
 * Rewrites the wikilinks of a block's text in place of their spans; other spans keep their
 * meaning with shifted offsets. Returns the new text and spans.
 */
export const rewriteText = (
  text: string,
  inline: readonly NoteInline[] | undefined,
  resolver: LinkResolver,
  stats: RewriteStats,
): { text: string; inline?: readonly NoteInline[] } => {
  if (!inline || !inline.some((s) => s.kind === "wikilink")) {
    return { text, inline };
  }
  let out = "";
  let cursor = 0;
  let shift = 0;
  const spans: NoteInline[] = [];
  for (const span of inline) {
    if (span.kind !== "wikilink") {
      spans.push({ ...span, start: span.start + shift, end: span.end + shift });
      continue;
    }
    const hit = resolver.resolve(span.target, [
      "note",
      "excalidrawMd",
      "drawing",
    ]);
    const written = writtenOf(span);
    const literal = hit
      ? drawingLink(linkTarget(hit.target), span.alias ?? written)
      : null;
    if (!literal) {
      stats.unresolved++;
      spans.push({ ...span, start: span.start + shift, end: span.end + shift });
      continue;
    }
    stats.rewritten++;
    out += text.slice(cursor, span.start) + literal;
    cursor = span.end;
    const start = span.start + shift;
    spans.push({
      kind: "wikilink",
      start,
      end: start + literal.length,
      target: linkTarget(hit!.target),
      ...(span.alias !== undefined || written !== linkTarget(hit!.target)
        ? { alias: span.alias ?? written }
        : {}),
    });
    shift += literal.length - (span.end - span.start);
  }
  out += text.slice(cursor);
  return { text: out, inline: spans };
};

const rewriteBlock = (
  b: NoteBlock,
  resolver: LinkResolver,
  stats: RewriteStats,
): NoteBlock => {
  switch (b.kind) {
    case "heading":
    case "paragraph":
    case "listItem": {
      const r = rewriteText(b.text, b.inline, resolver, stats);
      return r.text === b.text ? b : { ...b, text: r.text, inline: r.inline };
    }
    case "embed": {
      // `![[Note]]`: drawn as a link line; point it at the converted drawing like a wikilink.
      const hit = resolver.resolve(b.target, [
        "note",
        "excalidrawMd",
        "drawing",
      ]);
      if (!hit) {
        stats.unresolved++;
        return b;
      }
      stats.rewritten++;
      return { ...b, target: linkTarget(hit.target) };
    }
    case "blockquote":
    case "callout":
    case "footnoteDef":
      return {
        ...b,
        blocks: b.blocks.map((c) => rewriteBlock(c, resolver, stats)),
      };
    default:
      return b;
  }
};

/** A copy of `doc` with every resolvable wikilink rewritten to a Vaultdraw drawing link. */
export const rewriteLinks = (
  doc: NoteDoc,
  resolver: LinkResolver,
): { doc: NoteDoc; stats: RewriteStats } => {
  const stats: RewriteStats = { rewritten: 0, unresolved: 0 };
  const blocks = doc.blocks.map((b) => rewriteBlock(b, resolver, stats));
  return { doc: { ...doc, blocks }, stats };
};
