import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { placeholderBoxes, webPictureBoxes } from "./placeholders";

// One case table for this and the import plugin's pairBoxes (twins, testing.md).
const TABLE = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../plugins/official/markdown-import/test/fixtures/placeholder-boxes.json",
    ),
    "utf8",
  ),
) as { cases: Case[] };

export interface Case {
  name: string;
  label: string;
  labelLink: "same" | "none" | "other";
  link: string;
  bound?: boolean;
  outside?: boolean;
  pairs: number;
  web: number;
}

export const sceneOf = (c: Case) => [
  {
    id: "box",
    type: "rectangle",
    x: 56,
    y: 356,
    width: 480,
    height: 300,
    link: c.link || null,
  },
  {
    id: "label",
    type: "text",
    x: c.outside ? 600 : 64,
    y: 364,
    width: 464,
    height: 20,
    text: c.label,
    link:
      c.labelLink === "same"
        ? c.link
        : c.labelLink === "other"
        ? "https://elsewhere.example"
        : null,
    containerId: c.bound ? "box" : null,
  },
];

describe("placeholder boxes: every style the import ever wrote", () => {
  test.each(TABLE.cases)("$name", (c) => {
    expect(placeholderBoxes(sceneOf(c))).toHaveLength(c.pairs);
    expect(webPictureBoxes({ elements: sceneOf(c) })).toBe(c.web);
  });

  test("deleted elements are not boxes", () => {
    const els = sceneOf(TABLE.cases[0]).map((e) => ({ ...e, isDeleted: true }));
    expect(placeholderBoxes(els)).toHaveLength(0);
  });

  test("two texts in a box without links: not a placeholder", () => {
    const [box, label] = sceneOf({ ...TABLE.cases[0], labelLink: "none" });
    expect(placeholderBoxes([box, label, { ...label, id: "b" }])).toHaveLength(
      0,
    );
  });
});
