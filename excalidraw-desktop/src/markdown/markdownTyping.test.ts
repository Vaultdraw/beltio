/**
 * The typing behaviour against a fake editor session: what each key does and
 * what it must not do. The real session (packages wysiwyg) is covered by the
 * Playwright spec markdown-typing.spec.ts.
 */
import { describe, expect, it } from "vitest";

import type {
  TextEditorListeners,
  TextEditorSession,
} from "@excalidraw/excalidraw/types";

import { createMarkdownTyping } from "./markdownTyping";
import { DEFAULT_MARKDOWN_TYPING_SETTINGS } from "./markdownTyping";

type El = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  textAlign: string;
  customData?: Record<string, unknown>;
  text: string;
};

/** A tiny scene of text boxes with one being edited. */
function harness(opts: { on?: boolean; isLabel?: boolean } = {}) {
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
      lineHeight: 1.25,
      textAlign: "left",
      text: "",
      ...p,
    };
    els.set(el.id, el);
    return el;
  };
  const ext = createMarkdownTyping({
    isOn: () => on,
    getSettings: () => DEFAULT_MARKDOWN_TYPING_SETTINGS,
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
        if ("customData" in patch) {
          e.customData = patch.customData;
        }
        measure(e);
      },
      continueInNewText: ({ x, y, text, caret: c, fontSize, customData }) => {
        submit();
        const created = add({ x, y, text, fontSize, customData });
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

describe("Markdown typing: headings", () => {
  it.each([1, 2, 3, 4, 5, 6])(
    "%i # and a space make heading N at once",
    (level) => {
      const h = harness();
      h.type(`${"#".repeat(level)} `);
      expect(h.textarea.value).toBe("");
      expect(h.current().customData).toEqual({ role: `h${level}` });
      expect(h.current().fontSize).toBe(
        20 * DEFAULT_MARKDOWN_TYPING_SETTINGS.headingScales[level - 1],
      );
    },
  );

  it("7 # stay plain text", () => {
    const h = harness();
    h.type("####### x");
    expect(h.textarea.value).toBe("####### x");
    expect(h.current().customData).toBeUndefined();
  });

  it("# inside a line stays plain (a tag or text)", () => {
    const h = harness();
    h.type("a # b #tag ");
    expect(h.textarea.value).toBe("a # b #tag ");
    expect(h.current().customData).toBeUndefined();
  });

  it("mode off: # and a space stay literal, existing headings stay", () => {
    const h = harness({ on: false });
    h.type("# Title");
    expect(h.textarea.value).toBe("# Title");
    expect(h.current().customData).toBeUndefined();
  });

  it("turned off mid-edit: the next # stays plain", () => {
    const h = harness();
    h.type("# Title");
    expect(h.current().customData).toEqual({ role: "h1" });
    h.setOn(false);
    h.press("Enter");
    // Enter is a plain newline again: still one box
    expect(h.all()).toHaveLength(1);
  });

  it("# before existing text makes that text the heading", () => {
    const h = harness();
    h.type("Title");
    h.textarea.setSelectionRange(0, 0);
    h.type("## ");
    expect(h.textarea.value).toBe("Title");
    expect(h.current().customData).toEqual({ role: "h2" });
  });

  it("CJK and emoji headings keep their text", () => {
    const h = harness();
    h.type("# 标题 😀");
    expect(h.textarea.value).toBe("标题 😀");
    expect(h.current().customData).toEqual({ role: "h1" });
  });

  it("IME composition never converts", () => {
    const h = harness();
    h.type("#");
    const handled = h.press(" ", { isComposing: true } as never);
    expect(handled).toBe(false);
    expect(h.current().customData).toBeUndefined();
  });

  it("a later line of a body box becomes a heading box below it", () => {
    const h = harness();
    h.type("body");
    h.press("Enter");
    h.type("## Section");
    const boxes = h.all();
    expect(boxes).toHaveLength(2);
    expect(boxes[0].text).toBe("body");
    expect(boxes[0].customData).toBeUndefined();
    expect(boxes[1].text).toBe("Section");
    expect(boxes[1].customData).toEqual({ role: "h2" });
    expect(boxes[1].y).toBeGreaterThan(boxes[0].y + boxes[0].height);
    expect(boxes[1].x).toBe(boxes[0].x);
  });

  it("a line with lines below it stays plain", () => {
    const h = harness();
    h.type("a");
    h.press("Enter");
    h.type("b");
    h.textarea.setSelectionRange(0, 0);
    h.type("# ");
    expect(h.textarea.value).toBe("# a\nb");
    expect(h.all()).toHaveLength(1);
  });

  it("a label (text in a shape) converts in place on its only line, never splits", () => {
    const h = harness({ isLabel: true });
    h.type("# Box");
    expect(h.current().customData).toEqual({ role: "h1" });
    h.press("Enter");
    expect(h.all()).toHaveLength(1);
    expect(h.textarea.value).toBe("Box\n");
  });
});

describe("Markdown typing: Enter, Backspace, undo", () => {
  it("Enter after a heading starts a body box below, same x, body size", () => {
    const h = harness();
    h.type("# Title");
    h.press("Enter");
    h.type("body");
    const [title, body] = h.all();
    expect(title.text).toBe("Title");
    expect(title.customData).toEqual({ role: "h1" });
    expect(title.fontSize).toBe(40);
    expect(body.text).toBe("body");
    expect(body.customData).toBeUndefined();
    expect(body.fontSize).toBe(20);
    expect(body.x).toBe(title.x);
    // a gap of half a body line below the heading
    expect(body.y).toBe(title.y + title.height + 0.5 * 20 * 1.25);
  });

  it("Enter in the middle of a heading moves the rest into the body box", () => {
    const h = harness();
    h.type("# Hello world");
    h.textarea.setSelectionRange(5, 5);
    h.press("Enter");
    const [title, body] = h.all();
    expect(title.text).toBe("Hello");
    expect(body.text).toBe(" world");
    expect(h.textarea.selectionStart).toBe(0);
  });

  it("Enter on an empty heading turns it back into body text", () => {
    const h = harness();
    h.type("# ");
    h.press("Enter");
    expect(h.all()).toHaveLength(1);
    expect(h.current().customData).toBeUndefined();
    expect(h.current().fontSize).toBe(20);
  });

  it("Shift+Enter in a heading is a plain new line", () => {
    const h = harness();
    h.type("# Title");
    h.press("Enter", { shiftKey: true });
    expect(h.all()).toHaveLength(1);
  });

  it("Enter in body text is a plain new line", () => {
    const h = harness();
    h.type("body");
    h.press("Enter");
    expect(h.all()).toHaveLength(1);
    expect(h.textarea.value).toBe("body\n");
  });

  it("Backspace at the start of a heading turns it into body text", () => {
    const h = harness();
    h.type("### Title");
    h.textarea.setSelectionRange(0, 0);
    h.press("Backspace");
    expect(h.textarea.value).toBe("Title");
    expect(h.current().customData).toBeUndefined();
    expect(h.current().fontSize).toBe(20);
  });

  it("Backspace inside a heading deletes a character only", () => {
    const h = harness();
    h.type("# Title");
    h.press("Backspace");
    expect(h.textarea.value).toBe("Titl");
    expect(h.current().customData).toEqual({ role: "h1" });
  });

  it("Backspace in the empty box Enter made goes back to the heading", () => {
    const h = harness();
    h.type("# Title");
    h.press("Enter");
    h.press("Backspace");
    expect(h.all()).toHaveLength(1);
    expect(h.current().text).toBe("Title");
    expect(h.current().customData).toEqual({ role: "h1" });
  });

  it("Cmd+Z right after a conversion restores the literal # ", () => {
    const h = harness();
    h.type("# ");
    expect(h.current().customData).toEqual({ role: "h1" });
    h.press("z", { metaKey: true });
    expect(h.textarea.value).toBe("# ");
    expect(h.current().customData).toBeUndefined();
    expect(h.current().fontSize).toBe(20);
  });

  it("Ctrl+Z works the same", () => {
    const h = harness();
    h.type("## ");
    h.press("z", { ctrlKey: true });
    expect(h.textarea.value).toBe("## ");
  });

  it("Cmd+Z after typing more is the editor's own undo, not ours", () => {
    const h = harness();
    h.type("# T");
    expect(h.press("z", { metaKey: true })).toBe(false);
    expect(h.current().customData).toEqual({ role: "h1" });
  });

  it("Cmd+Z after a split conversion joins the line back", () => {
    const h = harness();
    h.type("body");
    h.press("Enter");
    h.type("## ");
    expect(h.all()).toHaveLength(2);
    h.press("z", { metaKey: true });
    expect(h.all()).toHaveLength(1);
    expect(h.current().text).toBe("body\n## ");
    expect(h.textarea.selectionStart).toBe(8);
  });
});
