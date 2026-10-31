/**
 * Family hunter canvas (2026-10-31): "a Markdown mark typed in a box renders". One table of
 * mark x box kind, against the same fake editor session as markdownTyping.test.ts (copied; the
 * harness there is private). Expected is what Obsidian's live preview shows. Rows marked
 * `broken` are it.fails with the toimprove number.
 */
import { describe, expect, it } from "vitest";

import type {
  TextEditorListeners,
  TextEditorSession,
} from "@excalidraw/excalidraw/types";

import { createMarkdownTyping } from "../markdown/markdownTyping";
import { DEFAULT_MARKDOWN_TYPING_SETTINGS } from "../markdown/markdownTyping";

type El = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: number;
  lineHeight: number;
  textAlign: string;
  customData?: Record<string, unknown>;
  strokeColor: string;
  text: string;
};

/** A tiny scene of text boxes with one being edited. */
function harness(
  opts: {
    on?: boolean;
    isLabel?: boolean;
    headingBold?: boolean;
    inlineStyles?: boolean;
    color?: string;
  } = {},
) {
  let on = opts.on ?? true;
  const els = new Map<string, El>();
  let nextId = 1;
  const add = (p: Partial<El>) => {
    const el: El = {
      id: `t${nextId++}`,
      x: 0,
      y: 0,
      width: 100,
      height: 25,
      fontSize: 20,
      fontFamily: 5,
      lineHeight: 1.25,
      textAlign: "left",
      strokeColor: opts.color ?? "#1e1e1e",
      text: "",
      ...p,
    };
    els.set(el.id, el);
    return el;
  };
  const ext = createMarkdownTyping({
    isOn: () => on,
    getSettings: () => ({
      ...DEFAULT_MARKDOWN_TYPING_SETTINGS,
      headingBold: opts.headingBold ?? true,
      inlineStyles: opts.inlineStyles ?? true,
    }),
  });
  const textarea = document.createElement("textarea");
  let editing = "";
  let listeners: TextEditorListeners | null = null;

  const measure = (el: El) => {
    el.height =
      Math.max(1, el.text.split("\n").length) * el.fontSize * el.lineHeight;
  };
  const start = (id: string, caret: number) => {
    listeners?.detach?.();
    editing = id;
    const el = els.get(id)!;
    textarea.value = el.text;
    textarea.setSelectionRange(caret, caret);
    const session: TextEditorSession = {
      editable: textarea,
      isLabel: !!opts.isLabel,
      getElement: () => (els.get(editing) as never) ?? null,
      setText: (text, c) => {
        textarea.value = text;
        textarea.setSelectionRange(c, c);
        const e = els.get(editing)!;
        e.text = text;
        measure(e);
      },
      restyle: (patch) => {
        const e = els.get(editing)!;
        if (patch.fontSize !== undefined) {
          e.fontSize = patch.fontSize;
        }
        if (patch.fontFamily !== undefined) {
          e.fontFamily = patch.fontFamily;
        }
        // As the editor's mutateElement: an undefined value changes nothing (hunter B-1, B-2:
        // the fake used to assign it, so "remove the role" passed here and failed in the app).
        if (patch.customData !== undefined) {
          e.customData = patch.customData;
        }
        measure(e);
      },
      continueInNewText: ({
        x,
        y,
        text,
        caret: c,
        fontSize,
        fontFamily,
        customData,
      }) => {
        const from = els.get(editing)!;
        submit();
        const created = add({
          x,
          y,
          text,
          fontSize,
          fontFamily: fontFamily ?? from.fontFamily,
          customData,
          strokeColor: from.strokeColor,
        });
        measure(created);
        start(created.id, c);
      },
      editText: (id, c, text) => {
        submit();
        if (text !== undefined) {
          els.get(id)!.text = text;
        }
        start(id, c);
      },
    };
    listeners = ext.attach(session);
  };
  const submit = () => {
    const e = els.get(editing);
    if (e && !e.text.trim()) {
      els.delete(e.id);
    }
  };
  /** Types like a user: printable keys insert unless a handler took them. */
  const press = (key: string, mods: Partial<KeyboardEventInit> = {}) => {
    const event = new KeyboardEvent("keydown", {
      key,
      cancelable: true,
      ...mods,
    });
    const handled = listeners?.onKeyDown?.(event) ?? false;
    if (handled || event.defaultPrevented) {
      return true;
    }
    const v = textarea.value;
    const { selectionStart: s, selectionEnd: t } = textarea;
    let next = v;
    let caret = s;
    if ([...key].length === 1 && !mods.metaKey && !mods.ctrlKey) {
      next = v.slice(0, s) + key + v.slice(t);
      caret = s + key.length;
    } else if (key === "Enter") {
      next = `${v.slice(0, s)}\n${v.slice(t)}`;
      caret = s + 1;
    } else if (key === "Backspace" && s > 0) {
      next = v.slice(0, s - 1) + v.slice(t);
      caret = s - 1;
    }
    textarea.value = next;
    textarea.setSelectionRange(caret, caret);
    const e = els.get(editing)!;
    e.text = next;
    measure(e);
    return false;
  };
  const type = (s: string) => [...s].forEach((c) => press(c));
  const current = () => els.get(editing)!;
  const first = add({});
  start(first.id, 0);
  return {
    els,
    press,
    type,
    current,
    textarea,
    setOn: (v: boolean) => (on = v),
    start,
    add,
    all: () => [...els.values()],
  };
}

const BOLD_FONT = 105;
const CODE_FONT = 3;
const BODY_FONT = 5;

type Kind = { name: string; prefix: string; label?: boolean };
const KINDS: Kind[] = [
  { name: "free text", prefix: "" },
  { name: "heading", prefix: "# " },
  { name: "quote", prefix: "> " },
  { name: "shape label", prefix: "", label: true },
  { name: "bullet item", prefix: "- " },
  { name: "task item", prefix: "- [ ] " },
  { name: "numbered item", prefix: "1. " },
];

// what the box looks like after typing prefix + mark: [text without marks, font]
type Want = { text: string; font: number } | "literal";
type Row = { kind: string; mark: string; want: Want; broken?: number };

const bold = (text: string): Want => ({ text, font: BOLD_FONT });
const code = (text: string): Want => ({ text, font: CODE_FONT });

const ROWS: Row[] = [
  { kind: "free text", mark: "**Bold**", want: bold("Bold") },
  { kind: "free text", mark: "`code`", want: code("code") },
  { kind: "free text", mark: "__Bold__", want: bold("Bold"), broken: 300 },
  { kind: "free text", mark: "**a * b**", want: bold("a * b"), broken: 300 },
  { kind: "heading", mark: "**Bold**", want: bold("Bold") },
  { kind: "heading", mark: "__Bold__", want: bold("Bold"), broken: 300 },
  { kind: "quote", mark: "**Bold**", want: bold("Bold") },
  { kind: "quote", mark: "`code`", want: code("code") },
  { kind: "quote", mark: "__Bold__", want: bold("Bold"), broken: 300 },
  { kind: "shape label", mark: "**Bold**", want: bold("Bold") },
  { kind: "shape label", mark: "`code`", want: code("code") },
  { kind: "shape label", mark: "__Bold__", want: bold("Bold"), broken: 300 },
  // a one-item list: the marks stay in the text and nothing is bold or code
  { kind: "bullet item", mark: "**Bold**", want: "literal", broken: 300 },
  { kind: "task item", mark: "**Bold**", want: "literal", broken: 300 },
  { kind: "numbered item", mark: "**Bold**", want: "literal", broken: 300 },
];

describe("family: a Markdown mark typed in a box renders", () => {
  for (const row of ROWS) {
    const kind = KINDS.find((k) => k.name === row.kind)!;
    // "literal" rows describe what happens today: the test states what Obsidian does instead
    const run = () => {
      const h = harness({ isLabel: kind.label });
      h.type(kind.prefix + row.mark);
      const shown = h.textarea.value;
      const font = h.current().fontFamily;
      if (row.want === "literal") {
        // Obsidian renders the mark inside a list item: the stars are gone
        expect(shown).not.toContain("**");
      } else {
        expect(shown).toBe(row.want.text);
        expect(font).toBe(row.want.font);
      }
    };
    (row.broken !== undefined ? it.fails : it)(`${row.kind}: ${row.mark}`, run);
  }

  it("sanity: no mark converts anything with the mode off", () => {
    const h = harness({ on: false });
    h.type("__Bold__");
    expect(h.textarea.value).toBe("__Bold__");
    expect(h.current().fontFamily).toBe(BODY_FONT);
  });
});
