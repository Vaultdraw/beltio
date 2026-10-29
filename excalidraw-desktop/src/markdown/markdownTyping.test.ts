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
  fontFamily: number;
  lineHeight: number;
  textAlign: string;
  customData?: Record<string, unknown>;
  text: string;
};

/** A tiny scene of text boxes with one being edited. */
function harness(
  opts: { on?: boolean; isLabel?: boolean; headingBold?: boolean } = {},
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
    expect(h.current().customData?.role).toBeUndefined();
  });

  it("# inside a line stays plain (a tag or text)", () => {
    const h = harness();
    h.type("a # b #tag ");
    expect(h.textarea.value).toBe("a # b #tag ");
    expect(h.current().customData?.role).toBeUndefined();
  });

  it("mode off: # and a space stay literal, existing headings stay", () => {
    const h = harness({ on: false });
    h.type("# Title");
    expect(h.textarea.value).toBe("# Title");
    expect(h.current().customData?.role).toBeUndefined();
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
    expect(h.current().customData?.role).toBeUndefined();
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
    expect(h.current().customData?.role).toBeUndefined();
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
    expect(h.current().customData?.role).toBeUndefined();
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
    expect(h.current().customData?.role).toBeUndefined();
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

describe("Markdown typing: lists and tasks", () => {
  it.each([
    ["- ", "• "],
    ["* ", "• "],
    ["[ ] ", "☐ "],
    ["- [ ] ", "☐ "],
    ["- [x] ", "☑ "],
  ])("%j becomes %j, in the same box", (typed, shown) => {
    const h = harness();
    h.type(typed);
    expect(h.textarea.value).toBe(shown);
    expect(h.all()).toHaveLength(1);
    expect(h.current().customData?.role).toBeUndefined();
  });

  it("Enter continues a bullet list; Enter on an empty item ends it", () => {
    const h = harness();
    h.type("- milk");
    h.press("Enter");
    h.type("eggs");
    h.press("Enter");
    expect(h.textarea.value).toBe("• milk\n• eggs\n• ");
    h.press("Enter");
    expect(h.textarea.value).toBe("• milk\n• eggs\n");
    h.type("after");
    expect(h.textarea.value).toBe("• milk\n• eggs\nafter");
    expect(h.all()).toHaveLength(1);
  });

  it("numbers count up; tasks continue open", () => {
    const h = harness();
    h.type("1. one");
    h.press("Enter");
    h.type("two");
    expect(h.textarea.value).toBe("1. one\n2. two");
    const t = harness();
    t.type("- [x] done");
    t.press("Enter");
    expect(t.textarea.value).toBe("☑ done\n☐ ");
  });

  it("nested items keep their indent", () => {
    const h = harness();
    h.type("    - deep");
    h.press("Enter");
    expect(h.textarea.value).toBe("    • deep\n    • ");
  });

  it("Enter in the middle of an item splits it into two items", () => {
    const h = harness();
    h.type("- ab");
    h.textarea.setSelectionRange(3, 3);
    h.press("Enter");
    expect(h.textarea.value).toBe("• a\n• b");
  });

  it("Backspace right after a marker removes it, keeps the text", () => {
    const h = harness();
    h.type("- item");
    h.textarea.setSelectionRange(2, 2);
    h.press("Backspace");
    expect(h.textarea.value).toBe("item");
  });

  it("Cmd+Z right after a list conversion brings the - back", () => {
    const h = harness();
    h.type("- ");
    h.press("z", { metaKey: true });
    expect(h.textarea.value).toBe("- ");
  });

  it("a dash inside a line stays a dash", () => {
    const h = harness();
    h.type("a - b");
    expect(h.textarea.value).toBe("a - b");
  });

  it("mode off: - stays a dash and Enter is a plain new line", () => {
    const h = harness({ on: false });
    h.type("- a");
    h.press("Enter");
    expect(h.textarea.value).toBe("- a\n");
  });

  it("lists work in a label too", () => {
    const h = harness({ isLabel: true });
    h.type("- a");
    h.press("Enter");
    expect(h.textarea.value).toBe("• a\n• ");
  });
});

describe("Markdown typing: quotes", () => {
  it("> and a space make a quote box at body size", () => {
    const h = harness();
    h.type("> wise words");
    expect(h.textarea.value).toBe("wise words");
    expect(h.current().customData).toEqual({ role: "quote" });
    expect(h.current().fontSize).toBe(20);
  });

  it("Enter in a quote is a new line; Enter on the empty last line ends it", () => {
    const h = harness();
    h.type("> one");
    h.press("Enter");
    h.type("two");
    h.press("Enter");
    expect(h.all()).toHaveLength(1);
    h.press("Enter");
    const [quote, body] = h.all();
    expect(quote.text).toBe("one\ntwo");
    expect(quote.customData).toEqual({ role: "quote" });
    expect(body.customData).toBeUndefined();
    expect(body.y).toBeGreaterThan(quote.y + quote.height);
  });

  it("Backspace at the start of a quote makes it body text", () => {
    const h = harness();
    h.type("> q");
    h.textarea.setSelectionRange(0, 0);
    h.press("Backspace");
    expect(h.current().customData?.role).toBeUndefined();
    expect(h.textarea.value).toBe("q");
  });

  it("Cmd+Z right after brings the > back", () => {
    const h = harness();
    h.type("> ");
    h.press("z", { metaKey: true });
    expect(h.textarea.value).toBe("> ");
    expect(h.current().customData?.role).toBeUndefined();
  });

  it("> on a later line splits into a quote box below", () => {
    const h = harness();
    h.type("body");
    h.press("Enter");
    h.type("> said");
    const [body, quote] = h.all();
    expect(body.text).toBe("body");
    expect(quote.text).toBe("said");
    expect(quote.customData).toEqual({ role: "quote" });
  });
});

describe("Markdown typing: bold headings", () => {
  it("a heading takes the bold variant of the font; Enter's body box is regular again", () => {
    const h = harness();
    h.type("## Title");
    expect(h.current().fontFamily).toBe(105);
    h.press("Enter");
    h.type("body");
    expect(h.current().fontFamily).toBe(5);
    expect(h.all().find((e) => e.text === "Title")?.fontFamily).toBe(105);
  });

  it("a heading made on a later line is bold in its new box", () => {
    const h = harness();
    h.type("intro");
    h.press("Enter", { shiftKey: true });
    h.textarea.value = "intro\n";
    h.textarea.setSelectionRange(6, 6);
    h.type("# Big ");
    expect(h.all().some((e) => e.fontFamily === 105)).toBe(true);
    expect(h.all().find((e) => e.text.startsWith("intro"))?.fontFamily).toBe(5);
  });

  it("Backspace at the start of a heading and Enter on an empty one make regular text", () => {
    const h = harness();
    h.type("# ");
    expect(h.current().fontFamily).toBe(105);
    h.press("Backspace");
    expect(h.current().fontFamily).toBe(5);
    const g = harness();
    g.type("# ");
    g.press("Enter");
    expect(g.current().fontFamily).toBe(5);
  });

  it("Cmd+Z right after the # restores the font", () => {
    const h = harness();
    h.type("# ");
    h.press("z", { metaKey: true });
    expect(h.current().fontFamily).toBe(5);
  });

  it("heading_bold off: headings keep the regular font", () => {
    const h = harness({ headingBold: false });
    h.type("# Title");
    expect(h.current().fontFamily).toBe(5);
    expect(h.current().customData).toEqual({ role: "h1" });
  });

  it("a font that has no bold variant (Lilita One) stays as it is", () => {
    const h = harness();
    h.current().fontFamily = 7;
    h.type("# Title");
    expect(h.current().fontFamily).toBe(7);
  });

  it("a quote is never bold", () => {
    const h = harness();
    h.type("> ");
    expect(h.current().fontFamily).toBe(5);
  });
});
