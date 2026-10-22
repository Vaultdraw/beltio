import { describe, expect, it } from "vitest";

import { byId, makeElements } from "./testUtils";
import { SceneOpsError } from "./types";
import { validateOps } from "./validate";

const els = makeElements(2);
const live = byId(els);
const id = els[0].id;
const gone = { ...els[1], isDeleted: true };
const withDeleted = byId([els[0], gone]);

const issuesOf = (ops: unknown, existing = live) => {
  try {
    validateOps(ops, existing);
  } catch (e) {
    expect(e).toBeInstanceOf(SceneOpsError);
    return (e as SceneOpsError).issues;
  }
  return [];
};
const add = (element: Record<string, unknown>) => ({ op: "add", element });

describe("validateOps", () => {
  it("accepts a valid mixed batch", () => {
    const ops = [
      add({
        type: "rectangle",
        x: 1,
        y: 2,
        width: 10,
        height: 10,
        strokeColor: "#ff0000",
        backgroundColor: "teal",
      }),
      add({ type: "text", text: "hi", fontSize: 20 }),
      add({
        type: "arrow",
        points: [
          [0, 0],
          [10, 10],
        ],
      }),
      {
        op: "update",
        id,
        props: { x: 5, opacity: 50, backgroundColor: "#abc" },
      },
      { op: "delete", id },
    ];
    expect(validateOps(ops, live)).toEqual(ops);
  });

  it.each([
    ["not an array", {}, undefined],
    ["non-object op", [1], undefined],
    ["unknown op", [{ op: "move" }], "op"],
    ["unknown add type", [add({ type: "star" })], "type"],
    ["unknown prop", [add({ type: "rectangle", bogus: 1 })], "bogus"],
    ["unknown update prop", [{ op: "update", id, props: { id: "x" } }], "id"],
    ["NaN", [add({ type: "rectangle", x: NaN })], "x"],
    ["Infinity", [add({ type: "rectangle", y: Infinity })], "y"],
    ["string number", [add({ type: "rectangle", x: "1" })], "x"],
    ["out of range", [add({ type: "rectangle", x: 1e7 + 1 })], "x"],
    ["zero width", [add({ type: "rectangle", width: 0 })], "width"],
    ["huge height", [add({ type: "rectangle", height: 1e6 + 1 })], "height"],
    ["long text", [add({ type: "text", text: "a".repeat(10_001) })], "text"],
    ["text without text", [add({ type: "text" })], "text"],
    [
      "bad colour",
      [add({ type: "rectangle", strokeColor: "url(x)" })],
      "strokeColor",
    ],
    [
      "bad bg colour",
      [add({ type: "rectangle", backgroundColor: "#12" })],
      "backgroundColor",
    ],
    ["bad points", [add({ type: "line", points: [[0, "a"]] })], "points"],
    [
      "update missing id",
      [{ op: "update", id: "nope", props: { x: 1 } }],
      "id",
    ],
    ["delete missing id", [{ op: "delete", id: "nope" }], "id"],
    [
      "update deleted id",
      [{ op: "update", id: gone.id, props: { x: 1 } }],
      "id",
    ],
    ["delete deleted id", [{ op: "delete", id: gone.id }], "id"],
    [
      "text prop on a rectangle",
      [{ op: "update", id, props: { text: "x" } }],
      "text",
    ],
  ])("rejects %s", (_n, ops, key) => {
    const issues = issuesOf(ops, withDeleted.has(id) ? withDeleted : live);
    expect(issues.length).toBeGreaterThan(0);
    if (key) {
      expect(issues.some((i) => i.key === key)).toBe(true);
    }
  });

  it("rejects 501 ops but accepts 500", () => {
    const op = add({ type: "rectangle" });
    expect(issuesOf(Array(501).fill(op))).toHaveLength(1);
    expect(issuesOf(Array(500).fill(op))).toHaveLength(0);
  });

  it("lists every issue of a mixed valid+invalid batch with op indices", () => {
    const issues = issuesOf([
      add({ type: "rectangle" }),
      add({ type: "rectangle", x: NaN }),
      { op: "delete", id: "nope" },
    ]);
    expect(issues.map((i) => i.op)).toEqual([1, 2]);
  });
});
