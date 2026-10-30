/**
 * Toimprove 233: the note editor marks as a tag exactly what the tag pane lists (tags/grammar.ts),
 * not colours like `#1e1e1e` or words like `C#`.
 */
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { describe, expect, it } from "vitest";

import { findTags } from "../tags/grammar";

import { markdownSupport } from "./markdownLang";

const marked = (line: string) => {
  const state = EditorState.create({
    doc: line,
    extensions: markdownSupport(),
  });
  const tree = ensureSyntaxTree(state, state.doc.length, 5000)!;
  const out: string[] = [];
  highlightTree(tree, classHighlighter, (from, to, cls) => {
    if (cls.includes("tok-atom")) {
      out.push(line.slice(from + 1, to));
    }
  });
  return out;
};

describe("note editor tag marks follow the tag grammar", () => {
  for (const line of [
    "a #tag here",
    "colour #1e1e1e and #ff00aa",
    "ends #tag- and #a/b/",
    'quote "#q", list,#c, x:#k',
    "C# and issue#12",
    "#café #2024 #_under",
  ]) {
    it(line, () => {
      expect(marked(line)).toEqual(findTags(line).map((m) => m.display));
    });
  }
});
