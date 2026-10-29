import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { builtinRegistry, findTheme } from "../theme/registry";

import {
  registerCanvasRepaint,
  resetCanvasSync,
  setCanvasSync,
  setCanvasThemeSource,
  setPageDisplay,
  withStandardCanvasColors,
} from "./canvasSync";

const { calls, roleCalls } = vi.hoisted(() => ({
  calls: [] as Array<{
    fn: ((c: string, d: boolean) => string) | null;
    canvas: string | null;
  }>,
  roleCalls: [] as Array<((role: string, d: boolean) => string | null) | null>,
}));

vi.mock("@excalidraw/excalidraw", () => ({
  setDisplayColorTransform: (
    fn: ((c: string, d: boolean) => string) | null,
    canvas: string | null = null,
  ) => {
    calls.push({ fn, canvas });
  },
  setDisplayTextRoleColor: (
    fn: ((role: string, d: boolean) => string | null) | null,
  ) => {
    roleCalls.push(fn);
  },
  invertColorForDarkMode: (c: string) => (c === "#ffffff" ? "#121212" : c),
}));

const dracula = findTheme(builtinRegistry(), "Dracula")!;
const source = {
  variant: dracula.theme.dark,
  mode: "dark" as const,
  key: "dracula-dark",
};
const last = () => calls[calls.length - 1];

beforeEach(() => {
  calls.length = 0;
  roleCalls.length = 0;
});
afterEach(() => resetCanvasSync());

describe("page mode display override", () => {
  it("normal / old school paper: identity transform, no pinned surface, even with sync on", () => {
    setCanvasSync(source);
    setPageDisplay("identity");
    expect(last().fn!("#ffffff", true)).toBe("#ffffff");
    expect(last().canvas).toBeNull();
    // page mode off: the global sync is back
    setPageDisplay(null);
    expect(last().fn!("#ffffff", false)).toBe(source.variant.mSurface);
    expect(last().canvas).toBe(source.variant.mSurface);
  });

  it("identity also applies when sync is off (dark UI keeps light paper)", () => {
    setPageDisplay("identity");
    expect(last().fn!("#1e1e1e", true)).toBe("#1e1e1e");
    setPageDisplay(null);
    expect(last().fn).toBeNull();
  });

  it("match: the theme transform and surface, with sync off", () => {
    setCanvasThemeSource(source);
    expect(calls).toHaveLength(0);
    setPageDisplay("match");
    expect(last().fn!("#ffffff", false)).toBe(source.variant.mSurface);
    expect(last().canvas).toBe(source.variant.mSurface);
  });

  it("match equals what sync produces (same transform)", () => {
    setCanvasSync(source);
    const sync = last().fn;
    setCanvasThemeSource(source);
    setPageDisplay("match");
    expect(last().fn).toBe(sync);
  });

  it("repaints on a change, not on the same value", () => {
    const repaint = vi.fn();
    const off = registerCanvasRepaint(repaint);
    expect(setPageDisplay("identity")).toBe(true);
    expect(setPageDisplay("identity")).toBe(false);
    expect(repaint).toHaveBeenCalledTimes(1);
    off();
  });

  it("exports run with standard colours, then the page display returns", async () => {
    setPageDisplay("identity");
    let during: unknown = "unset";
    await withStandardCanvasColors(async () => {
      during = last().fn;
    });
    expect(during).toBeNull();
    expect(last().fn!("#fff", true)).toBe("#fff");
  });

  it("heading roles follow the theme, with contrast on the canvas shown", () => {
    setCanvasThemeSource(source);
    const resolve = roleCalls[roleCalls.length - 1]!;
    expect(resolve).toBeTypeOf("function");
    // sync off: Excalidraw's own canvas (white, dark = inverted white)
    const light = resolve("h1", false)!;
    const dark = resolve("h1", true)!;
    expect(light).toMatch(/^#[0-9a-f]{6}$/);
    expect(dark).toMatch(/^#[0-9a-f]{6}$/);
    expect(resolve("body", false)).toBeNull();
    // sync on: drawn on the theme's surface
    setCanvasSync(source);
    const synced = roleCalls[roleCalls.length - 1]!;
    expect(synced("h2", true)).toBe(synced("h2", false));
  });

  it("exports draw roles in the stored colour", async () => {
    setCanvasThemeSource(source);
    let during: unknown = "unset";
    await withStandardCanvasColors(async () => {
      during = roleCalls[roleCalls.length - 1];
    });
    expect(during).toBeNull();
    expect(roleCalls[roleCalls.length - 1]).toBeTypeOf("function");
  });
});
