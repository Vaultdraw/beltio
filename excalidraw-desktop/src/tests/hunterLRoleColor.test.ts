/**
 * Hunter L (2026-10-30 night), family of toimprove 238 (a picked colour wins over a text role's
 * colour). 238 set `customData.roleColorPicked` in the colour panel's action only.
 *
 * L-1: Paste styles (Cmd+Alt+V) copies a black body text's colour, size and font onto a heading,
 * but the heading keeps the theme's heading colour: the flag is not set on that path (nor by the
 * eyedropper, App.tsx openEyeDropper -> getColorUpdate without the flag).
 *
 * L-2: the flag outlives the role. A heading whose colour was once picked, turned back into body
 * text (Backspace at its start) and made a heading again (`# `), keeps the old pick forever, while
 * any other coloured body text made a heading takes the theme's heading colour (roles.ts
 * `roleBase`: "the role colour applies while the stored colour is still roleBase").
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  getTextDisplayColor,
  ROLE_COLOR_PICKED,
  setDisplayTextRoleColor,
} from "@excalidraw/common";
import { newTextElement } from "@excalidraw/element";
import { Scene } from "@excalidraw/element";
import {
  actionCopyStyles,
  actionPasteStyles,
} from "@excalidraw/excalidraw/actions/actionStyles";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";

import type {
  ExcalidrawTextElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  TextEditorListeners,
  TextEditorSession,
} from "@excalidraw/excalidraw/types";

import {
  createMarkdownTyping,
  DEFAULT_MARKDOWN_TYPING_SETTINGS,
} from "../markdown/markdownTyping";

const THEME_H1 = "#c92a2a";
// the role colour resolver's rule (roleColors.ts buildRoleColor): the stored colour is the
// default black or the colour the box had when it got the role -> the theme's colour
const resolver = (
  role: string,
  _dark: boolean,
  stored: string,
  base?: string,
) => {
  const s = stored.toLowerCase();
  const defaultish = s === "#1e1e1e" || s === "#000000" || s === base;
  return role === "h1" && defaultish ? THEME_H1 : null;
};

afterEach(() => setDisplayTextRoleColor(null));

type T = OrderedExcalidrawElement & ExcalidrawTextElement;

describe("hunter L-1: Paste styles onto a heading", () => {
  it.fails("pasting a black body text's style makes the heading black", () => {
    setDisplayTextRoleColor(resolver);
    const body = {
      ...newTextElement({ text: "body", x: 0, y: 0, fontSize: 20 }),
      index: "a0",
    } as unknown as T;
    const h1 = {
      ...newTextElement({ text: "Plan", x: 0, y: 100, fontSize: 40 }),
      index: "a1",
      customData: { role: "h1" },
    } as unknown as T;
    // sanity: the heading is drawn in the theme's colour
    expect(getTextDisplayColor(h1, false)).toBe(THEME_H1);
    const scene = new Scene([body, h1]);
    const app = { scene } as never;
    const state = (id: string) =>
      ({
        ...getDefaultAppState(),
        selectedElementIds: { [id]: true },
      } as never);
    actionCopyStyles.perform([body, h1], state(body.id), null, app);
    const out = actionPasteStyles.perform(
      [body, h1],
      state(h1.id),
      null,
      app,
    ) as { elements: readonly typeof body[] };
    const pasted = out.elements.find((e) => e.id === h1.id)!;
    // the size and font came over from the body text...
    expect(pasted.fontSize).toBe(20);
    // ...the colour on screen did not
    expect(getTextDisplayColor(pasted, false)).toBe("#1e1e1e");
  });
});

const session = (el: Record<string, any>) => {
  const textarea = document.createElement("textarea");
  textarea.value = el.text;
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
      Object.assign(el, p);
    },
    continueInNewText: () => {},
    editText: () => {},
  };
  const listeners: TextEditorListeners | null = createMarkdownTyping({
    isOn: () => true,
    getSettings: () => DEFAULT_MARKDOWN_TYPING_SETTINGS,
  }).attach(s);
  const key = (k: string) =>
    listeners?.onKeyDown?.(
      new KeyboardEvent("keydown", { key: k, cancelable: true }),
    );
  const caret = (c: number) => textarea.setSelectionRange(c, c);
  return { textarea, key, caret };
};

const red = () => ({
  id: "t",
  text: "Title",
  fontSize: 20,
  fontFamily: 5,
  lineHeight: 1.25,
  textAlign: "left",
  strokeColor: "#e03131",
  x: 0,
  y: 0,
  width: 100,
  height: 25,
  customData: undefined as Record<string, unknown> | undefined,
});

/** `# ` typed at the start of the box's only line. */
const makeHeading = (el: Record<string, any>) => {
  const h = session(el);
  h.textarea.value = `#${el.text}`;
  el.text = h.textarea.value;
  h.caret(1);
  expect(h.key(" ")).toBe(true);
};

describe("hunter L-2: a picked heading colour outlives the heading", () => {
  it("sanity: a red body text made a heading takes the theme's colour", () => {
    setDisplayTextRoleColor(resolver);
    const el = red();
    makeHeading(el);
    expect(el.customData).toMatchObject({ role: "h1" });
    expect(getTextDisplayColor(el as never, false)).toBe(THEME_H1);
  });

  it.fails(
    "a heading made body text and a heading again takes the theme's colour too",
    () => {
      setDisplayTextRoleColor(resolver);
      // a heading whose colour the user picked once (red, from the colour panel)
      const el = {
        ...red(),
        fontSize: 40,
        fontFamily: 105,
        customData: {
          role: "h1",
          bodySize: 20,
          [ROLE_COLOR_PICKED]: true,
        } as Record<string, unknown>,
      };
      // Backspace at its start: body text again
      const h = session(el);
      h.caret(0);
      expect(h.key("Backspace")).toBe(true);
      expect(el.customData?.role).toBeUndefined();
      // `# ` again: a heading, like any other red body text
      makeHeading(el);
      expect(el.customData).toMatchObject({ role: "h1" });
      expect(getTextDisplayColor(el as never, false)).toBe(THEME_H1);
    },
  );
});
