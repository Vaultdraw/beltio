/**
 * Family (validator, 2026-10-30, after toimprove 170): "Enter at the end of a heading, or Backspace
 * at its start, gives body text of the note's body size" fails for headings from some source.
 *
 * Every way a heading box comes into being is a row: typed now, typed under another
 * `markdown.h1_size`, typed before the fix (no remembered size), and imported from a note at every
 * level and two body sizes. The imported rows build the element the way the import does
 * (the import's `HEADING_SCALE` read from its source, `buildPageElements` with the import's data key), not a hand-made stand-in:
 * the hunter E-5 evidence used a hand-made "imported" heading at scale 2, while the import really
 * uses Obsidian's steps 1.8, 1.6, 1.4, 1.25, 1.125, 1, so the 0381b502 fallback (today's typing
 * default scale 2, 1.5, 1.25, …) still gives an imported heading the wrong body size
 * (h1 from 16 px: 29 / 2 = 14.5 px). Rows that fail today are `it.fails`; drop `fails` when fixed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { TextEditorSession } from "@excalidraw/excalidraw/types";

import { buildPageElements } from "../../../sdk/api/shared/pageItems";

import {
  createMarkdownTyping,
  DEFAULT_MARKDOWN_TYPING_SETTINGS,
} from "./markdownTyping";

import type { PageItem } from "../../../sdk/api/src/pages";

type El = {
  id: string;
  fontSize: number;
  customData?: Record<string, unknown>;
  [k: string]: unknown;
};

const box = (fontSize: number, customData: Record<string, unknown>): El => ({
  id: "h",
  x: 0,
  y: 0,
  width: 300,
  height: 50,
  fontSize,
  fontFamily: 5,
  lineHeight: 1.25,
  textAlign: "left",
  strokeColor: "#1e1e1e",
  customData,
  text: "Title",
});

// The import's own heading steps, read from its source (the plugin is not part of this
// TypeScript project): `HEADING_SCALE` in markdown-import/src/layout/fonts.ts, sizes rounded to
// 0.5 px as its `fontPlan` does.
const IMPORT_SCALE = JSON.parse(
  /const HEADING_SCALE = (\[[^\]]+\])/.exec(
    readFileSync(
      resolve(
        __dirname,
        "../../../plugins/official/markdown-import/src/layout/fonts.ts",
      ),
      "utf8",
    ),
  )![1],
) as number[];
const importSize = (level: number, body: number) =>
  Math.round(body * IMPORT_SCALE[level - 1] * 2) / 2;

/** A heading exactly as the Markdown import writes it. */
const imported = (level: number, body: number): El => {
  const role = `h${level}`;
  const size = importSize(level, body);
  const item = {
    type: "text",
    page: 0,
    x: 0,
    y: 0,
    width: 300,
    height: 50,
    text: "Title",
    fontSize: size,
    fontFamily: "sans",
    tone: `heading${level}`,
    data: { heading: level, role },
  } as unknown as PageItem;
  const { elements } = buildPageElements([item], {
    dataKey: "plugins.markdown-import",
    id: () => "h",
    seed: () => 1,
    now: () => 1,
  });
  const el = elements[0] as unknown as El;
  return { ...box(el.fontSize, el.customData ?? {}), text: "Title" };
};

const run = (
  el: El,
  scales: readonly number[],
  key: "Enter" | "Backspace",
): number | undefined => {
  const textarea = document.createElement("textarea");
  textarea.value = "Title";
  const at = key === "Enter" ? 5 : 0;
  textarea.setSelectionRange(at, at);
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
    getSettings: () => ({
      ...DEFAULT_MARKDOWN_TYPING_SETTINGS,
      headingScales: scales,
    }),
  });
  ext
    .attach(session)
    ?.onKeyDown?.(new KeyboardEvent("keydown", { key, cancelable: true }));
  const call =
    key === "Enter" ? continueInNewText.mock.calls[0] : restyle.mock.calls[0];
  return call?.[0]?.fontSize;
};

const DEFAULT = DEFAULT_MARKDOWN_TYPING_SETTINGS.headingScales;
const TRIPLE = [3, 1.5, 1.25, 1.125, 1, 1];

type Row = {
  name: string;
  el: () => El;
  scales: readonly number[];
  body: number;
  broken?: boolean;
};

const rows: Row[] = [
  {
    name: "typed h1, remembered body 20, scale changed to 3 since",
    el: () => box(40, { role: "h1", bodySize: 20 }),
    scales: TRIPLE,
    body: 20,
  },
  {
    name: "typed h1 before the fix (no remembered size), default scale",
    el: () => box(40, { role: "h1" }),
    scales: DEFAULT,
    body: 20,
  },
  {
    name: "typed h2, remembered body 16",
    el: () => box(24, { role: "h2", bodySize: 16 }),
    scales: DEFAULT,
    body: 16,
  },
  ...[16, 20].flatMap((body) =>
    [1, 2, 3, 4, 5, 6].map(
      (level): Row => ({
        name: `imported h${level} from a ${body} px note`,
        el: () => imported(level, body),
        scales: DEFAULT,
        body,
        // h6 is scale 1 in both tables; every other level differs (0381b502 divides by the typing
        // default, not the import's steps).
        broken: level !== 6,
      }),
    ),
  ),
];

describe("family: a heading's body size, from every source of heading", () => {
  for (const key of ["Enter", "Backspace"] as const) {
    for (const row of rows) {
      const test = row.broken ? it.fails : it;
      test(`${key}: ${row.name} gives ${row.body} px body text`, () => {
        const size = run(row.el(), row.scales, key);
        expect(size).toBeDefined();
        expect(Math.abs((size ?? 0) - row.body)).toBeLessThanOrEqual(0.25);
      });
    }
  }
});
