/**
 * Parity with the CLI. `vaultdraw scene read|get` with the app closed projects a
 * drawing's elements in Rust (vaultdraw-core scene_project.rs); both sides read
 * the golden file `scene-project-parity.json`: the slim elements and the scene
 * version string must match. After an intended change, regenerate it with
 * `UPDATE_PARITY=1 npx vitest run src/control/sceneProjectParity.test.ts` and
 * make the Rust side pass `cargo test -p vaultdraw-core scene_project`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { toSceneElement } from "../sceneOps";

import { hashScene } from "./sceneVersion";

const GOLDEN = resolve(
  __dirname,
  "../../src-tauri/crates/vaultdraw-core/tests/fixtures/scene-project-parity.json",
);

const el = (over: Record<string, unknown>) => ({
  id: "a",
  type: "rectangle",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  angle: 0,
  version: 1,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  isDeleted: false,
  ...over,
});

const CASES: { name: string; elements: Record<string, unknown>[] }[] = [
  { name: "empty", elements: [] },
  {
    name: "plain shapes",
    elements: [
      el({ id: "r1", x: 12.5, y: -4, version: 3 }),
      el({ id: "e1", type: "ellipse", version: 77 }),
      el({ id: "d1", type: "diamond", angle: 1.5707963267948966 }),
    ],
  },
  {
    name: "text keeps its text, other types do not",
    elements: [
      el({ id: "t1", type: "text", text: "Hello\nworld", version: 4 }),
      el({ id: "t2", type: "text", text: "", version: 2 }),
      el({ id: "r2", text: "ignored on a rectangle" }),
    ],
  },
  {
    name: "unknown type becomes other",
    elements: [
      el({ id: "x1", type: "embeddable", version: 9 }),
      el({ id: "x2", type: "iframe" }),
    ],
  },
  {
    name: "deleted elements are dropped from both",
    elements: [
      el({ id: "k1", version: 5 }),
      el({ id: "k2", isDeleted: true, version: 8 }),
      el({ id: "k3", version: 6 }),
    ],
  },
  {
    name: "unicode and big versions (UTF-16 hashing)",
    elements: [
      el({ id: "é→😀", version: 2147483647, type: "text", text: "日本語 😀" }),
      el({ id: "plain", version: 1234567890123 }),
    ],
  },
  {
    name: "missing colours",
    elements: [
      {
        id: "m1",
        type: "line",
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        angle: 0,
        version: 1,
      },
    ],
  },
  {
    name: "many elements",
    elements: Array.from({ length: 60 }, (_, i) =>
      el({ id: `n${i}`, x: i * 3, y: i, version: i + 1 }),
    ),
  },
];

const compute = (elements: Record<string, unknown>[]) => {
  const els = elements as unknown as ExcalidrawElement[];
  return {
    version: hashScene(els),
    projected: els.filter((e) => !e.isDeleted).map(toSceneElement),
  };
};

describe("scene projection: parity with the CLI", () => {
  if (process.env.UPDATE_PARITY) {
    it("regenerates the golden file", () => {
      const cases = CASES.map((c) => ({ ...c, ...compute(c.elements) }));
      writeFileSync(GOLDEN, `${JSON.stringify({ cases }, null, 2)}\n`);
    });
    return;
  }
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as {
    cases: (typeof CASES[number] & ReturnType<typeof compute>)[];
  };
  it("covers every case", () => {
    expect(golden.cases.map((c) => c.name)).toEqual(CASES.map((c) => c.name));
  });
  for (const c of golden.cases) {
    it(c.name, () => {
      expect(compute(c.elements)).toEqual({
        version: c.version,
        projected: c.projected,
      });
    });
  }
});
