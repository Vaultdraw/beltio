/**
 * Hunter L (2026-10-30 night) [canvas], next door to toimprove 237 (b4e617b5: Cmd+Z in the empty
 * box Enter made goes back to the heading, like Backspace).
 *
 * L-6: the rule fires whenever that box is empty, not only right after the Enter. Enter after a
 * heading, type a word, delete it (or select it and cut), then Cmd+Z to get the word back: the
 * extension takes the key (`undo()` -> `backToBlock`, preventDefault), editing jumps back to the
 * heading, the empty box is dropped and the word is gone for good (the canvas undo never had it).
 * Obsidian (and every editor) restores the deleted word on Cmd+Z.
 */
import { describe, expect, it } from "vitest";

import type {
  TextEditorListeners,
  TextEditorSession,
} from "@excalidraw/excalidraw/types";

import { createMarkdownTyping } from "../markdown/markdownTyping";
import { DEFAULT_MARKDOWN_TYPING_SETTINGS } from "../markdown/markdownTyping";

// the harness of markdown/markdownTyping.test.ts
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

describe("hunter L-6: Cmd+Z in the box Enter made, after typing in it", () => {
  it("sanity (237): Cmd+Z right after Enter goes back to the heading", () => {
    const h = harness();
    h.type("# Title");
    h.press("Enter");
    const heading = h.all()[0];
    expect(h.current().id).not.toBe(heading.id);
    expect(h.press("z", { metaKey: true })).toBe(true);
    expect(h.current().id).toBe(heading.id);
  });

  it("a word typed and deleted there comes back with Cmd+Z (the key is left to the text box)", () => {
    const h = harness();
    h.type("# Title");
    h.press("Enter");
    const body = h.current();
    h.type("word");
    for (let i = 0; i < 4; i++) {
      h.press("Backspace");
    }
    expect(h.textarea.value).toBe("");
    // the text box's own undo would bring "word" back: the extension must not take the key
    expect(h.press("z", { metaKey: true })).toBe(false);
    expect(h.current().id).toBe(body.id);
  });
});

/**
 * Hunter L-14 [improvement] (next door to 228 and the inline marks): a box that turned bold or
 * code by its marks keeps that look for everything typed after Enter, since Enter adds a line to
 * the same box. Obsidian: `**a**` or `` `a` `` then Enter, and the next line is plain text. Our
 * headings and quotes already end on Enter (endBox); the inline looks could do the same and start
 * a plain body box below.
 */
describe("hunter L-14: Enter after a box made bold or code by its marks", () => {
  it("sanity: the marks turn the box bold", () => {
    const h = harness();
    h.type("**a**");
    expect(h.current().fontFamily).toBe(105);
  });

  it.each([
    ["**a**", 105],
    ["`a`", 3],
  ])(
    "after %s, Enter starts plain text, not more of that look",
    (marks, look) => {
      const h = harness();
      h.type(marks);
      expect(h.current().fontFamily).toBe(look);
      h.press("Enter");
      h.type("b");
      expect(h.current().text).toBe("b");
      expect(h.current().fontFamily).toBe(5);
    },
  );
});

describe("toimprove 282: what Enter after a mark-made box does not do", () => {
  it("Enter in the middle of a bold box still adds a line in the box", () => {
    const h = harness();
    h.type("**ab**");
    h.textarea.setSelectionRange(1, 1);
    h.press("Enter");
    expect(h.current().text).toBe("a\nb");
    expect(h.current().fontFamily).toBe(105);
  });

  it("Backspace in the new empty box goes back to the bold box", () => {
    const h = harness();
    h.type("**a**");
    h.press("Enter");
    h.press("Backspace");
    expect(h.current().text).toBe("a");
    expect(h.current().fontFamily).toBe(105);
  });

  it("a box made bold with the Toggle bold command keeps adding lines (no marks were typed)", () => {
    const h = harness();
    h.type("a");
    h.current().fontFamily = 105;
    h.press("Enter");
    h.type("b");
    expect(h.current().text).toBe("a\nb");
  });
});
