import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { altOf, pairBoxes } from "../src/boxes";
import { isWebTarget } from "../src/webImages";

import type { BoxElement } from "../src/boxes";

// The same case table as the core's update pass (excalidraw-desktop/src/importUpgrade/placeholders.test.ts).
const TABLE = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/placeholder-boxes.json"), "utf8"),
) as {
  cases: {
    name: string;
    label: string;
    labelLink: "same" | "none" | "other";
    link: string;
    bound?: boolean;
    outside?: boolean;
    pairs: number;
    web: number;
  }[];
};

const sceneOf = (c: typeof TABLE.cases[number]): BoxElement[] => [
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

describe("pairBoxes: every placeholder style the import ever wrote", () => {
  test.each(TABLE.cases)("$name", (c) => {
    const pairs = pairBoxes(sceneOf(c));
    expect(pairs).toHaveLength(c.pairs);
    expect(pairs.filter((p) => isWebTarget(p.link))).toHaveLength(c.web);
  });
});

describe("altOf", () => {
  test.each([
    ["Web image: a cat", "a cat"],
    ["Web image, not downloaded (not https): a cat", "a cat"],
    ["Image not found: Pasted image 1.png", "Pasted image 1.png"],
    // An old label is the alt text itself, colons included.
    ["Kubernetes: the kernel", "Kubernetes: the kernel"],
    [
      "How to Install RAM in a PC | Tom's Hardware",
      "How to Install RAM in a PC | Tom's Hardware",
    ],
  ])("%s", (label, alt) => expect(altOf(label)).toBe(alt));
});
