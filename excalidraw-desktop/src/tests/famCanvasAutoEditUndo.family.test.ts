/**
 * Family hunter canvas (2026-10-31): "every automatic edit of Markdown typing is taken back by one Cmd+Z right after it".
 * The extension keeps its own undo for conversions only, but every automatic edit goes through
 * `session.setText` (`editable.value = ...`), which clears the textarea's own undo stack, so a
 * step the extension does not remember cannot be undone at all. One table of steps, against the same fake editor session as markdownTyping.test.ts (copied; the
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

type Step = {
  name: string;
  /** types up to the state just before the automatic edit; returns it */
  setup: (h: ReturnType<typeof harness>) => void;
  /** the key that makes the automatic edit */
  act: (h: ReturnType<typeof harness>) => void;
  broken?: number;
};

const STEPS: Step[] = [
  // the conversions (`- `, `# `, `> `, marks) are covered by markdownTyping.test.ts and huntI-bold-keys.spec.ts
  // the rest of the automatic edits
  {
    name: "Enter continues a bullet list",
    setup: (h) => h.type("- a"),
    act: (h) => h.press("Enter"),
    broken: 301,
  },
  {
    name: "Enter continues a numbered list",
    setup: (h) => h.type("1. a"),
    act: (h) => h.press("Enter"),
    broken: 301,
  },
  {
    name: "Enter continues a task list",
    setup: (h) => h.type("- [ ] a"),
    act: (h) => h.press("Enter"),
    broken: 301,
  },
  {
    name: "Enter on an empty item ends the list",
    setup: (h) => {
      h.type("- a");
      h.press("Enter");
    },
    act: (h) => h.press("Enter"),
    broken: 301,
  },
  {
    name: "Backspace right after a marker removes the marker",
    setup: (h) => {
      h.type("- a");
      h.press("Enter");
    },
    act: (h) => h.press("Backspace"),
    broken: 301,
  },
];

describe("family: one Cmd+Z takes back an automatic edit of Markdown typing", () => {
  for (const step of STEPS) {
    const run = () => {
      const h = harness();
      step.setup(h);
      const before = h.textarea.value;
      step.act(h);
      expect(h.textarea.value).not.toBe(before);
      // the extension must take the key itself: the textarea has no undo left to run
      const handled = h.press("z", { metaKey: true });
      expect(handled).toBe(true);
      expect(h.textarea.value).toBe(before);
    };
    (step.broken !== undefined ? it.fails : it)(step.name, run);
  }
});
