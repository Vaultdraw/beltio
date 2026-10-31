import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { continueMarkup, toggleMark } from "./noteEditKeys";

import type { StateCommand } from "@codemirror/state";

/** Runs `cmd` on `doc` with the selection between the `|` marks (one `|` = a cursor). */
const run = (cmd: StateCommand, marked: string) => {
  const a = marked.indexOf("|");
  const b = marked.indexOf("|", a + 1);
  const doc = marked.replace(/\|/g, "");
  let state = EditorState.create({
    doc,
    selection:
      b < 0 ? EditorSelection.cursor(a) : EditorSelection.range(a, b - 1),
  });
  const handled = cmd({
    state,
    dispatch: (tr) => {
      state = tr.state;
    },
  });
  const sel = state.selection.main;
  const text = state.doc.toString();
  const out = sel.empty
    ? `${text.slice(0, sel.head)}|${text.slice(sel.head)}`
    : `${text.slice(0, sel.from)}|${text.slice(sel.from, sel.to)}|${text.slice(
        sel.to,
      )}`;
  return handled ? out : null;
};

describe("Enter continues lists, tasks and quotes (Obsidian)", () => {
  it.each([
    ["- milk|", "- milk\n- |"],
    ["* milk|", "* milk\n* |"],
    ["  + milk|", "  + milk\n  + |"],
    ["1. one|", "1. one\n2. |"],
    ["9) nine|", "9) nine\n10) |"],
    ["- [x] done|", "- [x] done\n- [ ] |"],
    ["- [ ] todo|", "- [ ] todo\n- [ ] |"],
    ["> quote|", "> quote\n> |"],
    ["- mi|lk", "- mi\n- |lk"],
    ["- milk  |", "- milk\n- |"],
  ])("%j -> %j", (input, want) => {
    expect(run(continueMarkup, input)).toBe(want);
  });

  it.each([
    ["- |", "|"],
    ["  - |", "|"],
    ["1. |", "|"],
    ["- [ ] |", "|"],
    ["> |", "|"],
    ["- a\n- |", "- a\n|"],
  ])("an empty item ends the list: %j -> %j", (input, want) => {
    expect(run(continueMarkup, input)).toBe(want);
  });

  it.each([
    ["plain text|"],
    ["-|"],
    ["-not a list|"],
    ["# heading|"],
    ["```\n- in code|"],
    ["|- milk"],
    ["- |milk|"],
  ])("leaves %j to the default Enter", (input) => {
    expect(run(continueMarkup, input)).toBeNull();
  });

  it("continues again after a closed code block", () => {
    expect(run(continueMarkup, "```\nx\n```\n- a|")).toBe(
      "```\nx\n```\n- a\n- |",
    );
  });
});

describe("Bold and italic toggle their marks (Obsidian Cmd+B / Cmd+I)", () => {
  const bold = toggleMark("**");
  const italic = toggleMark("*");
  it.each([
    [bold, "say |word|", "say **|word|**"],
    [bold, "say **|word|**", "say |word|"],
    [bold, "say |**word**|", "say |word|"],
    [bold, "say |", "say **|**"],
    [bold, "a *|b|* c", "a ***|b|*** c"],
    [italic, "say |word|", "say *|word|*"],
    [italic, "say *|word|*", "say |word|"],
    [italic, "say |*word*|", "say |word|"],
    [italic, "say **|word|**", "say ***|word|***"],
    [italic, "say ***|word|***", "say **|word|**"],
    [bold, "say ***|word|***", "say *|word|*"],
  ])("%#: %j -> %j", (cmd, input, want) => {
    expect(run(cmd, input)).toBe(want);
  });
});
