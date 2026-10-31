/**
 * The note's facts for the side of the reading view (properties, tags, word
 * count) come from the Rust parser (`markdown_parse`, vaultdraw_core::markdown):
 * it knows code, frontmatter and tags exactly. The HTML itself is rendered by
 * render/obsidian.ts, which keeps bold and italic (NoteDoc text is plain).
 * Outside the desktop shell (browser harness, unit tests) a small stand-in
 * answers.
 */
import { fakeParseMarkdown } from "../../../sdk/api/shared/markdown";
import {
  isTauriAvailable,
  loadTauriInvoke,
} from "../vault/DesktopVaultRepository";

import type { NoteDoc } from "../plugins/api";

import { readFrontmatter } from "./standInFrontmatter";

/** The reading view's rule (render/obsidian.ts FRONTMATTER), one case table pins both. */
const FRONT =
  /^﻿?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** The browser stand-in: front matter keys, tags and counts. */
export function standInNoteDoc(text: string): NoteDoc {
  const m = FRONT.exec(text);
  const base = fakeParseMarkdown(m ? text.slice(m[0].length) : text);
  if (!m) {
    return base;
  }
  const { properties, tags, aliases } = readFrontmatter(m[1] ?? "");
  return {
    ...base,
    frontmatter: {
      range: [0, m[0].length],
      raw: m[1] ?? "",
      tags,
      aliases,
      properties,
    },
    tags: [...new Set([...tags, ...base.tags])],
  };
}

/** Parses `text` with the desktop parser, or the stand-in outside the app. */
export async function parseNoteDoc(text: string): Promise<NoteDoc> {
  const invoke = isTauriAvailable(window) ? await loadTauriInvoke() : null;
  if (!invoke) {
    return standInNoteDoc(text);
  }
  return invoke<NoteDoc>("markdown_parse", { text });
}
