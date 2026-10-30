/**
 * Hunter E-5 (2026-10-30, quiet): the body size a heading box falls back to is worked out as
 * `fontSize / (today's scale for its level)`, not remembered when the box was made. A heading from an
 * Obsidian import (fixed scale 2 for h1) or one made before the user changed `markdown.h1_size`
 * therefore gives a wrong body size: Enter at its end starts a box of the wrong size, and
 * Backspace at its start shrinks or grows the text. Drop `fails` when the size comes out right.
 */
import { describe, expect, it, vi } from "vitest";

import type { TextEditorSession } from "@excalidraw/excalidraw/types";

import { createMarkdownTyping } from "./markdownTyping";
import { DEFAULT_MARKDOWN_TYPING_SETTINGS } from "./markdownTyping";

const THREE_TIMES = {
  ...DEFAULT_MARKDOWN_TYPING_SETTINGS,
  headingScales: [3, 1.5, 1.25, 1.125, 1, 1],
};

// An imported heading 1: 40 px text from a 20 px body (the import's fixed scale of 2).
const heading = () => ({
  id: "h",
  x: 0,
  y: 0,
  width: 300,
  height: 50,
  fontSize: 40,
  fontFamily: 5,
  lineHeight: 1.25,
  textAlign: "left",
  strokeColor: "#1e1e1e",
  customData: { role: "h1" },
  text: "Title",
});

function setup() {
  const el = heading();
  const textarea = document.createElement("textarea");
  textarea.value = el.text;
  textarea.setSelectionRange(el.text.length, el.text.length);
  const continueInNewText = vi.fn();
  const restyle = vi.fn();
  const session = {
    editable: textarea,
    isLabel: false,
    getElement: () => el,
    setText: vi.fn(),
    restyle,
    continueInNewText,
    editText: vi.fn(),
  } as unknown as TextEditorSession;
  const ext = createMarkdownTyping({
    isOn: () => true,
    getSettings: () => THREE_TIMES,
  });
  const listeners = ext.attach(session);
  const key = (k: string) =>
    listeners?.onKeyDown?.(
      new KeyboardEvent("keydown", { key: k, cancelable: true }),
    );
  return { key, continueInNewText, restyle, textarea };
}

describe("hunter E-5: body size under a changed heading scale", () => {
  it.fails("Enter after a 40 px heading starts a 20 px body box", () => {
    const s = setup();
    s.key("Enter");
    expect(s.continueInNewText).toHaveBeenCalled();
    expect(s.continueInNewText.mock.calls[0][0].fontSize).toBe(20);
  });
  it.fails(
    "Backspace at the start of a 40 px heading gives 20 px body text",
    () => {
      const s = setup();
      s.textarea.setSelectionRange(0, 0);
      s.key("Backspace");
      expect(s.restyle).toHaveBeenCalled();
      expect(s.restyle.mock.calls[0][0].fontSize).toBe(20);
    },
  );
});
