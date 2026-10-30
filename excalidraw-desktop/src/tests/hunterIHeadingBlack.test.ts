/**
 * Hunter I-13 (2026-10-30). A heading (typed or imported) is drawn in the theme's heading colour
 * unless the user picked a colour of their own (roleColors.ts: "a colour picked afterwards
 * differs and wins"). The editor's black swatch (#1e1e1e, the first stroke swatch) counts as "no
 * colour of its own" (DEFAULT_STORED), so picking it for a heading changes nothing on screen: the
 * heading stays in the theme's colour. Every other swatch works, and so does a typed #000000.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  getTextDisplayColor,
  ROLE_COLOR_PICKED,
  setDisplayTextRoleColor,
} from "@excalidraw/common";
import { newTextElement } from "@excalidraw/element";
import { actionChangeStrokeColor } from "@excalidraw/excalidraw/actions/actionProperties";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";

import { buildRoleColor, roleTokenColor } from "../markdown/roleColors";
import { loadBuiltinThemes } from "../theme";

const themes = await loadBuiltinThemes();
// a theme variant whose h1 colour is not black, so the difference is visible
const variant = themes
  .flatMap((t) => [t.light, t.dark])
  .find((v) => {
    const c = roleTokenColor(v, "h1")?.toLowerCase();
    return c && c !== "#1e1e1e" && c !== "#000000";
  })!;

describe("hunter I-13: picking black for a heading", () => {
  const colorOf = buildRoleColor(variant, variant.mSurface);

  it("sanity: a picked red wins over the theme's heading colour", () => {
    expect(colorOf("h1", "#e03131")).toBeNull();
  });

  it("sanity: a typed #000000 wins too", () => {
    expect(colorOf("h1", "#000000")).toBeNull();
  });

  it("the role colour wins over the default black a new heading stores", () => {
    expect(colorOf("h1", "#1e1e1e")).not.toBeNull();
  });
});

/**
 * toimprove 238: picking the black swatch sets `customData.roleColorPicked`
 * (actionChangeStrokeColor), and the on-screen colour then is the stored one.
 */
describe("toimprove 238: a picked colour wins, black included", () => {
  afterEach(() => setDisplayTextRoleColor(null));

  const heading = (customData: Record<string, unknown>) => ({
    strokeColor: "#1e1e1e",
    customData: { role: "h1", ...customData },
  });

  it("without the flag the heading shows its role colour", () => {
    setDisplayTextRoleColor(() => "#c92a2a");
    expect(getTextDisplayColor(heading({}), false)).toBe("#c92a2a");
  });

  it("with the flag the picked black shows", () => {
    setDisplayTextRoleColor(() => "#c92a2a");
    expect(
      getTextDisplayColor(heading({ [ROLE_COLOR_PICKED]: true }), false),
    ).toBe("#1e1e1e");
  });

  it("the stroke colour action sets the flag on a text with a role, and only there", () => {
    const h1 = newTextElement({ text: "Plan", x: 0, y: 0 });
    const withRole = { ...h1, customData: { role: "h1" } } as typeof h1;
    const plain = newTextElement({ text: "body", x: 0, y: 40 });
    const appState = {
      ...getDefaultAppState(),
      selectedElementIds: { [withRole.id]: true, [plain.id]: true },
    } as never;
    const result = actionChangeStrokeColor.perform(
      [withRole, plain] as never,
      appState,
      { color: "#1e1e1e" },
      null as never,
    ) as { elements: readonly any[] };
    const [a, b] = result.elements;
    expect(a.customData).toMatchObject({
      role: "h1",
      [ROLE_COLOR_PICKED]: true,
    });
    expect(b.customData?.[ROLE_COLOR_PICKED]).toBeUndefined();
  });
});
