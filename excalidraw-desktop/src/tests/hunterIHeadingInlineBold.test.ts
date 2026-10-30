import { describe, expect, it } from "vitest";

import type {
  TextEditorListeners,
  TextEditorSession,
} from "@excalidraw/excalidraw/types";

import { createMarkdownTyping } from "../markdown/markdownTyping";
import { DEFAULT_MARKDOWN_TYPING_SETTINGS } from "../markdown/markdownTyping";

/**
 * Hunter I-1 (2026-10-30). With `markdown.heading_bold = false` headings are drawn in the
 * regular font. Typing `# **Title**` then removes the marks but keeps the regular font:
 * `closeMark` (markdownTyping.ts) assumes "a heading is bold already" and skips the restyle.
 * The user's ** are eaten and nothing turns bold. Obsidian with a theme whose headings are not
 * bold draws `# **Title**` bold.
 */
const session = (headingBold: boolean) => {
  const el = {
    id: "t1",
    fontSize: 20,
    fontFamily: 5,
    lineHeight: 1.25,
    textAlign: "left",
    strokeColor: "#1e1e1e",
    x: 0,
    y: 0,
    width: 100,
    height: 25,
    text: "",
    customData: undefined as Record<string, unknown> | undefined,
  };
  const textarea = document.createElement("textarea");
  const s: TextEditorSession = {
    editable: textarea,
    isLabel: false,
    getElement: () => el as never,
    setText: (t, c) => {
      textarea.value = t;
      textarea.setSelectionRange(c, c);
      el.text = t;
    },
    restyle: (p) => {
      if (p.fontSize !== undefined) {
        el.fontSize = p.fontSize;
      }
      if (p.fontFamily !== undefined) {
        el.fontFamily = p.fontFamily;
      }
      if (p.customData !== undefined) {
        el.customData = p.customData as never;
      }
    },
    continueInNewText: () => {},
    editText: () => {},
  };
  const listeners: TextEditorListeners | null = createMarkdownTyping({
    isOn: () => true,
    getSettings: () => ({ ...DEFAULT_MARKDOWN_TYPING_SETTINGS, headingBold }),
  }).attach(s);
  const type = (str: string) => {
    for (const key of str) {
      const e = new KeyboardEvent("keydown", { key, cancelable: true });
      if (listeners?.onKeyDown?.(e)) {
        continue;
      }
      const v = textarea.value;
      textarea.value = v + key;
      textarea.setSelectionRange(v.length + 1, v.length + 1);
      el.text = textarea.value;
    }
  };
  return { el, textarea, type };
};

describe("hunter I-1: **bold** typed in a heading when headings are not bold", () => {
  it("sanity: heading_bold on, the heading is bold and the marks go", () => {
    const h = session(true);
    h.type("# **Title**");
    expect(h.textarea.value).toBe("Title");
    expect(h.el.fontFamily).toBe(105);
  });

  it("heading_bold off: the heading turns bold when its marks go", () => {
    const h = session(false);
    h.type("# **Title**");
    expect(h.el.customData).toMatchObject({ role: "h1" });
    expect(h.textarea.value).toBe("Title");
    expect(h.el.fontFamily).toBe(105);
  });
});

/**
 * Hunter I-9 (2026-10-30). A box typed as `` `npm run` `` turns into Cascadia but gets no role,
 * so it is drawn in the plain text colour. The theme has a code colour (`markdown.code`, which
 * roleColors.ts applies only to a text with the `code` role, like Obsidian's --code-normal for
 * inline code), and the Markdown import draws code in the theme's code tone. A typed code box
 * never takes it.
 */
describe("hunter I-9: a typed `code` box takes the theme's code colour", () => {
  it("sanity: the box is Cascadia and the marks go", () => {
    const h = session(true);
    h.type("`npm run`");
    expect(h.textarea.value).toBe("npm run");
    expect(h.el.fontFamily).toBe(3);
  });

  it("it carries the code role, so the theme's code colour applies", () => {
    const h = session(true);
    h.type("`npm run`");
    expect(h.el.customData).toMatchObject({ role: "code" });
  });
});
