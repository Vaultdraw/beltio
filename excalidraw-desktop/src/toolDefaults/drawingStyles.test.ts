import { loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import { describe, expect, it } from "vitest";

import { serializeSceneForSave } from "../editor/sceneSerializer";
import { DEFAULT_PREFERENCES } from "../vault/preferences";

import { baseStyleAppState } from "./baseStyle";
import {
  appendDrawingStyles,
  clearDrawingStyle,
  effectiveToolStyles,
  readDrawingMarkdown,
  readDrawingStyles,
  sanitizeDrawingStyles,
  setDrawingStyle,
} from "./drawingStyles";

const appState = { viewBackgroundColor: "#fff" };
const scene = () => serializeAsJSON([], appState, {}, "local");

describe("appendDrawingStyles / readDrawingStyles", () => {
  it("returns the input byte for byte when there is nothing to store", () => {
    const json = scene();
    expect(appendDrawingStyles(json, {})).toBe(json);
    expect(appendDrawingStyles(json, { arrow: {} })).toBe(json);
    expect(serializeSceneForSave([], appState, {})).toBe(json);
    expect(serializeSceneForSave([], appState, {}, {})).toBe(json);
  });

  it("appends a two-space block as the last key and reads it back", () => {
    const styles = {
      text: { font_family: 3 as const },
      arrow: { stroke_color: "#f08c00", stroke_width: 3 },
    };
    const out = serializeSceneForSave([], appState, {}, styles);
    expect(out.startsWith(scene().slice(0, -2))).toBe(true);
    expect(out.endsWith("\n  }\n}")).toBe(true);
    const parsed = JSON.parse(out);
    expect(Object.keys(parsed).at(-1)).toBe("vaultdraw");
    expect(parsed.vaultdraw.styles.arrow.stroke_width).toBe(3);
    expect(out).toContain('\n  "vaultdraw": {\n    "styles": {\n      "arrow"');
    expect(readDrawingStyles(out)).toEqual(styles);
  });

  it("round trips after a second save (block replaced, not duplicated)", () => {
    const first = serializeSceneForSave(
      [],
      appState,
      {},
      {
        rectangle: { opacity: 50 },
      },
    );
    expect(readDrawingStyles(first)).toEqual({ rectangle: { opacity: 50 } });
    const second = serializeSceneForSave([], appState, {}, {});
    expect(readDrawingStyles(second)).toEqual({});
    expect(second.includes("vaultdraw")).toBe(false);
  });

  it("reads from the tail of a very large file without parsing it", () => {
    const big = JSON.stringify(
      {
        type: "excalidraw",
        elements: [],
        files: { f: { dataURL: "x".repeat(30_000_000) } },
      },
      null,
      2,
    );
    const out = appendDrawingStyles(big, { line: { roundness: "sharp" } });
    const started = performance.now();
    expect(readDrawingStyles(out)).toEqual({ line: { roundness: "sharp" } });
    expect(performance.now() - started).toBeLessThan(50);
    expect(readDrawingStyles(big)).toEqual({});
  });

  it("gives {} for odd input", () => {
    for (const text of [
      "",
      "not json",
      '{"vaultdraw": ',
      '{"vaultdraw": {"styles": 5}\n}',
      '{"vaultdraw": [1]\n}',
      '{"vaultdraw": {"styles": {"arrow": {"stroke_color": "#fff"}}}, "x": 1\n}',
      '{"vaultdraw": null\n}',
    ]) {
      expect(readDrawingStyles(text)).toEqual({});
    }
    // text that merely mentions the key inside a string is not the block
    const sneaky = JSON.stringify({ text: '"vaultdraw": {}' }, null, 2);
    expect(readDrawingStyles(sneaky)).toEqual({});
  });

  it("drops junk: unknown tools and keys, invalid values, keys a tool does not own", () => {
    const clean = sanitizeDrawingStyles({
      arrow: { stroke_color: "#f08c00", font_size: 20, roughness: 7, bogus: 1 },
      freedraw: { stroke_color: "#000000" },
      text: { font_family: 4, font_size: 18, text_align: "left" },
      line: "nope",
    });
    expect(clean).toEqual({
      arrow: { stroke_color: "#f08c00" },
      text: { font_size: 18, text_align: "left" },
    });
    const out = appendDrawingStyles(scene(), {
      arrow: { roughness: 9 },
    } as never);
    expect(out).toBe(scene());
  });
});

describe("immutable helpers", () => {
  it("sets, clears and keeps identity when nothing changes", () => {
    const a = setDrawingStyle({}, "arrow", "stroke_color", "#f08c00");
    expect(a).toEqual({ arrow: { stroke_color: "#f08c00" } });
    expect(setDrawingStyle(a, "arrow", "stroke_color", "#f08c00")).toBe(a);
    expect(setDrawingStyle(a, "arrow", "stroke_color", "junk!")).toBe(a);
    const b = setDrawingStyle(a, "arrow", "opacity", 50);
    expect(Object.keys(b.arrow!)).toEqual(["stroke_color", "opacity"]);
    expect(a).toEqual({ arrow: { stroke_color: "#f08c00" } });
    expect(clearDrawingStyle(b, ["arrow"], ["opacity"])).toEqual(a);
    expect(clearDrawingStyle(a, ["arrow"], ["stroke_color"])).toEqual({});
    expect(clearDrawingStyle(a, ["line"])).toBe(a);
    expect(clearDrawingStyle(a, ["arrow"], ["opacity"])).toBe(a);
    expect(clearDrawingStyle(b, ["arrow"])).toEqual({});
  });
});

describe("precedence: built-in -> [editor] -> tool default -> this drawing", () => {
  it("layers the drawing over the tool default, per key", () => {
    const out = effectiveToolStyles(
      { arrow: { stroke_color: "#f08c00", stroke_width: 3 }, line: {} },
      { arrow: { stroke_color: "#e03131" }, text: { font_size: 30 } },
    );
    expect(out).toEqual({
      arrow: { stroke_color: "#e03131", stroke_width: 3 },
      text: { font_size: 30 },
    });
  });

  it("puts [editor] over Excalidraw's built-ins in the base style", () => {
    const base = baseStyleAppState({
      ...DEFAULT_PREFERENCES,
      defaultFontFamily: 3,
      defaultStrokeWidth: 4,
    });
    expect(base).toMatchObject({
      currentItemFontFamily: 3,
      currentItemStrokeWidthKey: "bold",
      currentItemArrowType: "round", // not an [editor] field: the built-in
      currentItemStartArrowhead: null,
    });
  });

  it("migration: a saved file's currentItem* never beats the [editor] font", async () => {
    const json = serializeAsJSON(
      [],
      { ...appState, currentItemFontFamily: 5 } as never,
      {},
      "local",
    );
    const loaded = await loadFromBlob(
      new Blob([json], { type: "application/json" }),
      null,
      null,
      null,
    );
    const opened = {
      ...loaded.appState,
      ...baseStyleAppState({ ...DEFAULT_PREFERENCES, defaultFontFamily: 3 }),
    };
    expect(opened.currentItemFontFamily).toBe(3);
    expect(readDrawingStyles(json)).toEqual({});
  });
});

describe("the drawing's Markdown mode switch in the vaultdraw block", () => {
  const sceneJson = '{\n  "type": "excalidraw",\n  "elements": []\n}';

  it.each([
    [true, null],
    [false, null],
    [true, { text: { font_size: 28 } }],
  ] as const)("markdown %s round-trips (styles %j)", (markdown, styles) => {
    const json = appendDrawingStyles(sceneJson, styles ?? {}, markdown);
    expect(readDrawingMarkdown(json)).toBe(markdown);
    expect(readDrawingStyles(json)).toEqual(styles ?? {});
    // still plain JSON any reader (excalidraw.com) parses
    expect(JSON.parse(json).type).toBe("excalidraw");
  });

  it("no switch and no styles: the file stays byte for byte", () => {
    expect(appendDrawingStyles(sceneJson, {}, null)).toBe(sceneJson);
    expect(readDrawingMarkdown(sceneJson)).toBeNull();
  });

  it("a non-boolean value reads as no switch", () => {
    const json = sceneJson.replace(
      /\n}$/,
      ',\n  "vaultdraw": {\n    "markdown": "yes"\n  }\n}',
    );
    expect(readDrawingMarkdown(json)).toBeNull();
  });
});
