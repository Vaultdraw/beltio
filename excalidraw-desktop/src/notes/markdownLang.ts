/**
 * Markdown colouring for the note editor: a small line-based tokenizer on
 * CodeMirror's StreamLanguage (headings, quotes, emphasis, code, links,
 * `[[wikilinks]]`, `#tags`, `^block ids`, fenced code, front matter). No
 * extra language package: it is a few hundred bytes of code, and only the
 * editor chunk ever loads it.
 */
import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

import { findTags, MAX_TAG_CHARS } from "../tags/grammar";

import type { StringStream } from "@codemirror/language";

interface State {
  fence: string | null;
  front: boolean;
  seenStart: boolean;
}

const language = StreamLanguage.define<State>({
  name: "note-markdown",
  startState: () => ({ fence: null, front: false, seenStart: false }),
  token(stream: StringStream, state: State) {
    if (stream.sol()) {
      if (!state.seenStart) {
        state.seenStart = true;
        if (stream.match(/^---\s*$/)) {
          state.front = true;
          return "meta";
        }
      } else if (state.front && stream.match(/^(?:---|\.\.\.)\s*$/)) {
        state.front = false;
        return "meta";
      }
      const f = stream.match(/^\s{0,3}(```|~~~)/);
      if (f && typeof f !== "boolean") {
        state.fence =
          state.fence === null
            ? f[1]
            : state.fence === f[1]
            ? null
            : state.fence;
        stream.skipToEnd();
        return "monospace";
      }
    }
    if (state.fence !== null) {
      stream.skipToEnd();
      return "monospace";
    }
    if (state.front) {
      stream.skipToEnd();
      return "meta";
    }
    if (stream.sol()) {
      if (stream.match(/^#{1,6}\s.*$/)) {
        return "heading";
      }
      if (stream.match(/^\s*>\s?/)) {
        return "quote";
      }
      // Any one status character, as Obsidian (`[/]`, `[-]`, `[>]`; toimprove 235).
      if (stream.match(/^\s*(?:[-*+]|\d+[.)])\s(?:\[[^\]\\\n]\]\s)?/)) {
        return "keyword";
      }
      if (stream.match(/^(?:---|\*\*\*|___)\s*$/)) {
        return "contentSeparator";
      }
    }
    if (stream.match(/^!?\[\[[^\]]*\]\]/)) {
      return "link";
    }
    if (stream.match(/^\[[^\]\n]*\]\([^)\n]*\)/)) {
      return "link";
    }
    if (stream.match(/^`[^`\n]*`/)) {
      return "monospace";
    }
    if (stream.match(/^(?:\*\*|__)(?=\S)[^\n]*?\S(?:\*\*|__)/)) {
      return "strong";
    }
    if (stream.match(/^(?:\*|_)(?=\S)[^\n*_]*?\S(?:\*|_)/)) {
      return "emphasis";
    }
    if (stream.match(/^==(?=\S)[^\n]*?\S==/)) {
      return "string";
    }
    if (stream.match(/^\$\$?[^\s$][^$\n]*\$\$?/)) {
      return "number";
    }
    if (stream.peek() === "#") {
      // The tag pane's grammar, so the editor marks exactly what the pane lists (toimprove 233).
      const prev = stream.pos > 0 ? stream.string[stream.pos - 1] : "";
      const m = findTags(
        prev +
          stream.string.slice(stream.pos, stream.pos + 4 * MAX_TAG_CHARS + 2),
      )[0];
      if (m && m.start === prev.length) {
        stream.pos += 1 + m.display.length;
        return "atom";
      }
    }
    if (stream.match(/^\^[\w-]+\s*$/)) {
      return "comment";
    }
    if (stream.match(/^https?:\/\/[^\s)>\]]+/)) {
      return "url";
    }
    stream.next();
    return null;
  },
  languageData: { commentTokens: { block: { open: "<!--", close: "-->" } } },
});

const highlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: "700", color: "var(--vault-text)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.quote, color: "var(--vault-text-muted)" },
  {
    tag: t.monospace,
    fontFamily: "var(--vd-mono, ui-monospace, Menlo, monospace)",
  },
  { tag: t.link, color: "var(--vault-primary)" },
  { tag: t.url, color: "var(--vault-primary)", textDecoration: "underline" },
  { tag: t.atom, color: "var(--vault-primary)" },
  {
    tag: [t.meta, t.comment, t.keyword, t.contentSeparator],
    color: "var(--vault-text-muted)",
  },
  { tag: [t.string, t.number], color: "var(--vault-warning)" },
]);

/** Language plus its colours. */
export const markdownSupport = () => [language, syntaxHighlighting(highlight)];
