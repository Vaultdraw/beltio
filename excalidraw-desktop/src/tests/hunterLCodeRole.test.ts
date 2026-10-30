/**
 * Hunter L (2026-10-30 night) [canvas], next door to toimprove 228 (e7578691: a typed `code` box
 * carries the `code` role, so the theme's code colour applies).
 *
 * L-7: nothing takes the role away again. Change the box's font back to a hand-drawn or normal
 * font in the properties panel and it no longer looks like code, but it is still painted in the
 * theme's code colour (actionChangeFontFamily keeps customData; Backspace at the start only ends
 * headings and quotes, isBoxRole). The only way back is Cmd+Z right after typing the backtick.
 * Obsidian: the code colour belongs to the code; remove the backticks and the colour goes.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  FONT_FAMILY,
  getTextDisplayColor,
  roleAfterFontChange,
  setDisplayTextRoleColor,
} from "@excalidraw/common";
import { newTextElement, Scene } from "@excalidraw/element";
import { actionChangeFontFamily } from "@excalidraw/excalidraw/actions/actionProperties";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";

const CODE_COLOR = "#2b8a3e";

afterEach(() => setDisplayTextRoleColor(null));

describe("hunter L-7: a code box changed back to a normal font", () => {
  it("is no longer painted in the code colour", () => {
    setDisplayTextRoleColor((role) => (role === "code" ? CODE_COLOR : null));
    // what typing `npm run` in Markdown mode makes (markdownTyping closeMark)
    const code = {
      ...newTextElement({
        text: "npm run",
        x: 0,
        y: 0,
        fontFamily: FONT_FAMILY.Cascadia,
      }),
      customData: { role: "code" },
    } as ReturnType<typeof newTextElement>;
    expect(getTextDisplayColor(code, false)).toBe(CODE_COLOR);
    const appState = {
      ...getDefaultAppState(),
      selectedElementIds: { [code.id]: true },
    } as never;
    const scene = new Scene([{ ...code, index: "a0" } as never]);
    const app = {
      scene,
      props: {},
      fonts: { onLoaded: () => {} },
    } as never;
    const out = actionChangeFontFamily.perform(
      [code] as never,
      appState,
      {
        currentItemFontFamily: FONT_FAMILY.Excalifont,
        currentHoveredFontFamily: null,
      },
      app,
    ) as { elements: readonly typeof code[] };
    const after = out.elements[0];
    expect(after.fontFamily).toBe(FONT_FAMILY.Excalifont);
    expect(getTextDisplayColor(after, false)).toBe(code.strokeColor);
  });
});

describe("roleAfterFontChange (toimprove 264)", () => {
  const code = { type: "text", customData: { role: "code", other: 1 } };
  it("keeps the code role in the code font, regular or bold", () => {
    expect(roleAfterFontChange(code, FONT_FAMILY.Cascadia)).toEqual({});
  });
  it("ends the code role (and only it) in any other font", () => {
    expect(roleAfterFontChange(code, FONT_FAMILY.Excalifont)).toEqual({
      customData: { other: 1 },
    });
  });
  it("leaves headings and other elements alone", () => {
    const heading = { type: "text", customData: { role: "h1" } };
    expect(roleAfterFontChange(heading, FONT_FAMILY.Excalifont)).toEqual({});
    expect(
      roleAfterFontChange({ type: "rectangle" }, FONT_FAMILY.Excalifont),
    ).toEqual({});
  });
});
