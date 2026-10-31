/**
 * Family hunter canvas (2026-10-31): "every [markdown] setting changes what typing does, as the
 * documentation says". The preferences go through `typingSettingsFrom` (the same mapping the app
 * uses) into the fake editor session of markdownTyping.test.ts (copied; its harness is private).
 * Each of the 10 keys that shape typing (h1_size to h6_size, block_gap, heading_bold,
 * inline_styles) has rows, with distinct values per level so a swapped index shows.
 */
import { describe, expect, it } from "vitest";

import type {
  TextEditorListeners,
  TextEditorSession,
} from "@excalidraw/excalidraw/types";

import {
  MARKDOWN_DEFAULTS,
  typingSettingsFrom,
} from "../markdown/markdownSettings";
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
    settings?: import("../markdown/markdownTyping").MarkdownTypingSettings;
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
    getSettings: () =>
      opts.settings ?? {
        ...DEFAULT_MARKDOWN_TYPING_SETTINGS,
        headingBold: opts.headingBold ?? true,
        inlineStyles: opts.inlineStyles ?? true,
      },
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

const BODY = 20;
const prefs = (over: Partial<typeof MARKDOWN_DEFAULTS>) => ({
  ...MARKDOWN_DEFAULTS,
  ...over,
});
// distinct sizes per level: a swapped or shifted index shows
const DISTINCT = {
  markdownH1Size: 2.1,
  markdownH2Size: 2.2,
  markdownH3Size: 2.3,
  markdownH4Size: 2.4,
  markdownH5Size: 2.5,
  markdownH6Size: 2.6,
};

describe("family: [markdown] settings that shape typing", () => {
  for (const level of [1, 2, 3, 4, 5, 6]) {
    it(`h${level}_size: ${"#".repeat(
      level,
    )} makes the heading that many times the text size`, () => {
      const h = harness({ settings: typingSettingsFrom(prefs(DISTINCT)) });
      h.type(`${"#".repeat(level)} `);
      expect(h.current().customData?.role).toBe(`h${level}`);
      expect(h.current().fontSize).toBeCloseTo(BODY * (2 + level / 10), 5);
    });
  }

  it.each([0.5, 8])("h1_size at its limit %s is used as written", (v) => {
    const h = harness({
      settings: typingSettingsFrom(prefs({ markdownH1Size: v })),
    });
    h.type("# ");
    expect(h.current().fontSize).toBeCloseTo(BODY * v, 5);
  });

  it("a size back at the text size (h5 and h6 default 1) leaves the body size", () => {
    const h = harness({ settings: typingSettingsFrom(prefs({})) });
    h.type("##### ");
    expect(h.current().fontSize).toBe(BODY);
  });

  it.each([0, 0.5, 2, 4])(
    "block_gap %s: Enter after a heading starts the body that many lines below it",
    (gap) => {
      const h = harness({
        settings: typingSettingsFrom(prefs({ markdownBlockGap: gap })),
      });
      h.type("# Plan");
      const heading = h.current();
      h.press("Enter");
      const body = h.current();
      expect(body.id).not.toBe(heading.id);
      expect(body.y).toBeCloseTo(
        heading.y + heading.height + gap * BODY * heading.lineHeight,
        5,
      );
    },
  );

  it("heading_bold off: a heading keeps the text's font; on: the bold face", () => {
    const off = harness({
      settings: typingSettingsFrom(prefs({ markdownHeadingBold: false })),
    });
    off.type("# ");
    expect(off.current().fontFamily).toBe(5);
    const on = harness({ settings: typingSettingsFrom(prefs({})) });
    on.type("# ");
    expect(on.current().fontFamily).toBe(105);
  });

  it("inline_styles off: **bold** and `code` stay typed; on: they convert", () => {
    const off = harness({
      settings: typingSettingsFrom(prefs({ markdownInlineStyles: false })),
    });
    off.type("**b** `c`");
    expect(off.textarea.value).toBe("**b** `c`");
    const on = harness({ settings: typingSettingsFrom(prefs({})) });
    on.type("**b**");
    expect(on.textarea.value).toBe("b");
  });

  it("every typing setting is one the mapping reads (a new [markdown] key must get rows here)", () => {
    const keys = Object.keys(MARKDOWN_DEFAULTS).sort();
    expect(keys).toEqual(
      [
        "markdownBlockGap",
        "markdownH1Size",
        "markdownH2Size",
        "markdownH3Size",
        "markdownH4Size",
        "markdownH5Size",
        "markdownH6Size",
        "markdownHeadingBold",
        "markdownInlineStyles",
        "markdownTyping",
      ].sort(),
    );
  });
});
