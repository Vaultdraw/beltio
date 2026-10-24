/** API revision 0.4.0 batch additions: refs, bound arrows, groups, data, new props. */
import { describe, expect, it } from "vitest";

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { applyOps } from "./apply";
import { elementData, sceneDetails } from "./project";
import { makeElements, stubApi } from "./testUtils";
import { SceneOpsError } from "./types";

import type { SceneOp } from "./types";

const KEY = "plugins.test";

const run = (
  ops: SceneOp[],
  els: ExcalidrawElement[] = [],
  options = { dataKey: KEY },
) => {
  const { api, updateScene } = stubApi(els);
  const result = applyOps(api, ops, options);
  expect(updateScene).toHaveBeenCalledTimes(1);
  const out = updateScene.mock.calls[0][0].elements as ExcalidrawElement[];
  const get = (id: string) => out.find((e) => e.id === id)!;
  return { result, out, get };
};

const box = (ref: string, x: number, text?: string): SceneOp => ({
  op: "add",
  ref,
  element: {
    type: "rectangle",
    x,
    y: 0,
    width: 100,
    height: 60,
    ...(text ? { text } : {}),
  },
});

describe("refs and bound arrows", () => {
  it("maps refs to ids and binds an arrow at both ends", () => {
    const { result, get } = run([
      box("a", 0, "A"),
      box("b", 300, "B"),
      {
        op: "add",
        ref: "ab",
        element: { type: "arrow", start: { ref: "a" }, end: { ref: "b" } },
      },
    ]);
    expect(Object.keys(result.refs).sort()).toEqual(["a", "ab", "b"]);
    expect(result.ids).toEqual([result.refs.a, result.refs.b, result.refs.ab]);
    const arrow = get(result.refs.ab) as ExcalidrawArrowElement;
    expect(arrow.startBinding?.elementId).toBe(result.refs.a);
    expect(arrow.endBinding?.elementId).toBe(result.refs.b);
    // Both boxes know about the arrow (so moving them moves it).
    for (const ref of ["a", "b"]) {
      expect(
        get(result.refs[ref]).boundElements?.some(
          (b) => b.id === result.refs.ab,
        ),
      ).toBe(true);
    }
    // The arrow runs between the boxes, left to right.
    const x1 = arrow.x + arrow.points[0][0];
    const x2 = arrow.x + arrow.points[arrow.points.length - 1][0];
    expect(x1).toBeGreaterThanOrEqual(90);
    expect(x2).toBeLessThanOrEqual(310);
    expect(x2).toBeGreaterThan(x1);
  });

  it("binds forward refs (the arrow before its boxes) and labels the arrow", () => {
    const { result, out } = run([
      {
        op: "add",
        ref: "ab",
        element: {
          type: "arrow",
          start: { ref: "a" },
          end: { ref: "b" },
          text: "yes",
        },
      },
      box("a", 0),
      box("b", 300),
    ]);
    const label = out.find(
      (e) =>
        e.type === "text" &&
        (e as ExcalidrawTextElement).containerId === result.refs.ab,
    );
    expect((label as ExcalidrawTextElement).text).toBe("yes");
    expect(result.ids).toHaveLength(3);
  });

  it("an unplaced flow is centred as a whole and the arrow stays bound", () => {
    const { result, get } = run([
      {
        op: "add",
        ref: "a",
        element: { type: "ellipse", width: 80, height: 80 },
      },
      {
        op: "add",
        ref: "b",
        element: { type: "diamond", width: 80, height: 80, x: 200 },
      },
      {
        op: "add",
        ref: "ab",
        element: { type: "arrow", start: { ref: "a" }, end: { ref: "b" } },
      },
    ]);
    const a = get(result.refs.a);
    const arrow = get(result.refs.ab) as ExcalidrawArrowElement;
    // The arrow moves with its start (a), so it still starts at a.
    expect(arrow.x).toBeGreaterThanOrEqual(a.x);
    expect(arrow.x).toBeLessThanOrEqual(a.x + a.width + 20);
  });

  it("rejects bad refs and ends, all or nothing", () => {
    const { api, updateScene } = stubApi([]);
    const issues = (ops: unknown) => {
      try {
        applyOps(api, ops, { dataKey: KEY });
      } catch (e) {
        expect(e).toBeInstanceOf(SceneOpsError);
        expect((e as SceneOpsError & { code: string }).code).toBe(
          "INVALID_ARGUMENT",
        );
        return (e as SceneOpsError).issues.map((i) => `${i.key}: ${i.message}`);
      }
      throw new Error("expected a rejection");
    };
    expect(issues([box("a", 0), box("a", 10)])).toEqual([
      "ref: ref already used in this batch",
    ]);
    expect(
      issues([
        { op: "add", ref: "bad ref", element: { type: "text", text: "x" } },
      ])[0],
    ).toMatch(/^ref: must be 1 to 64/);
    expect(
      issues([
        { op: "add", element: { type: "arrow", start: { ref: "nope" } } },
      ]),
    ).toEqual(["start: no add in this batch has this ref"]);
    expect(
      issues([
        box("a", 0),
        { op: "add", element: { type: "arrow", end: { id: "x" } } },
      ])[0],
    ).toMatch(/already on the canvas/);
    expect(
      issues([
        { op: "add", ref: "l", element: { type: "line" } },
        { op: "add", element: { type: "arrow", start: { ref: "l" } } },
      ])[0],
    ).toMatch(/binds only to/);
    expect(
      issues([
        box("a", 0),
        { op: "add", element: { type: "rectangle", start: { ref: "a" } } },
      ]),
    ).toEqual(["start: only valid on arrows"]);
    expect(
      issues([{ op: "add", element: { type: "text", text: "x" }, extra: 1 }]),
    ).toEqual(["extra: unknown property"]);
    expect(updateScene).not.toHaveBeenCalled();
  });
});

describe("groups", () => {
  it("groups new elements by ref and an existing one by id, labels included", () => {
    const els = makeElements(1);
    const { result, out, get } = run(
      [
        box("a", 0, "A"),
        box("b", 300),
        { op: "group", ids: [{ ref: "a" }, { ref: "b" }, els[0].id] },
        { op: "group", ids: [{ ref: "a" }, { ref: "b" }] },
      ],
      els,
    );
    const a = get(result.refs.a);
    const b = get(result.refs.b);
    const old = get(els[0].id);
    expect(a.groupIds).toHaveLength(2);
    expect(b.groupIds).toEqual(a.groupIds);
    expect(old.groupIds).toEqual([a.groupIds[0]]);
    expect(old.version).toBeGreaterThan(els[0].version);
    const label = out.find(
      (e) => (e as ExcalidrawTextElement).containerId === a.id,
    )!;
    expect(label.groupIds).toEqual(a.groupIds);
  });

  it("rejects groups of one, unknown members, duplicates and labels", () => {
    const { api } = stubApi([]);
    const fail = (ops: unknown) =>
      expect(() => applyOps(api, ops, { dataKey: KEY })).toThrow(SceneOpsError);
    fail([box("a", 0), { op: "group", ids: [{ ref: "a" }] }]);
    fail([box("a", 0), { op: "group", ids: [{ ref: "a" }, "missing"] }]);
    fail([box("a", 0), { op: "group", ids: [{ ref: "a" }, { ref: "a" }] }]);
    fail([box("a", 0), { op: "group", ids: [{ ref: "a" }, 3] }]);
  });
});

describe("plugin data", () => {
  it("stores data under the key, reads it back, updates and removes it", () => {
    const { result, get, out } = run([
      {
        op: "add",
        ref: "a",
        element: { type: "rectangle", x: 0, y: 0, data: { n: 1 } },
      },
    ]);
    const a = get(result.refs.a);
    expect(a.customData).toEqual({ [KEY]: { n: 1 } });
    expect(elementData(out, a.id, KEY)).toEqual({ n: 1 });
    expect(elementData(out, a.id, "other")).toBeUndefined();

    const withOther = [
      { ...a, customData: { ...a.customData, other: true } },
    ] as ExcalidrawElement[];
    const second = run(
      [{ op: "update", id: a.id, props: { data: { n: 2 } } }],
      withOther,
    );
    expect(second.get(a.id).customData).toEqual({
      [KEY]: { n: 2 },
      other: true,
    });
    const third = run(
      [{ op: "update", id: a.id, props: { data: null } }],
      withOther,
    );
    expect(third.get(a.id).customData).toEqual({ other: true });
  });

  it("refuses data without a key, non-JSON data and data over 4 KiB", () => {
    const { api } = stubApi([]);
    const add = (data: unknown) => ({
      op: "add",
      element: { type: "rectangle", data },
    });
    expect(() => applyOps(api, [add({ a: 1 })])).toThrow(/not available/);
    expect(() =>
      applyOps(api, [add({ f: () => 1 })], { dataKey: KEY }),
    ).toThrow(/must be JSON/);
    expect(() =>
      applyOps(api, [add({ s: "x".repeat(4100) })], { dataKey: KEY }),
    ).toThrow(/4096 bytes/);
  });

  it("data is copied on read, never shared with the drawing", () => {
    const { result, out } = run([
      {
        op: "add",
        ref: "a",
        element: { type: "rectangle", data: { list: [1] } },
      },
    ]);
    const copy = elementData(out, result.refs.a, KEY) as { list: number[] };
    copy.list.push(2);
    expect(elementData(out, result.refs.a, KEY)).toEqual({ list: [1] });
  });
});

describe("new props", () => {
  it("applies style, angle, roundness, font, link and lock on add and update", () => {
    const { result, get } = run([
      {
        op: "add",
        ref: "r",
        element: {
          type: "rectangle",
          x: 0,
          y: 0,
          strokeStyle: "dashed",
          fillStyle: "solid",
          roundness: "round",
          angle: -Math.PI / 2,
          link: "https://example.com",
          locked: true,
        },
      },
      {
        op: "add",
        ref: "t",
        element: { type: "text", text: "hi", fontFamily: "Nunito" },
      },
    ]);
    const r = get(result.refs.r);
    expect(r).toMatchObject({
      strokeStyle: "dashed",
      fillStyle: "solid",
      link: "https://example.com",
      locked: true,
    });
    expect(r.roundness).not.toBeNull();
    expect(r.angle).toBeCloseTo((3 * Math.PI) / 2);
    const t = get(result.refs.t) as ExcalidrawTextElement;
    expect(t.fontFamily).toBe(6);

    const next = run(
      [
        { op: "update", id: r.id, props: { roundness: "sharp", link: null } },
        {
          op: "update",
          id: t.id,
          props: { fontFamily: "Cascadia", fontSize: 40 },
        },
      ],
      [r, t],
    );
    expect(next.get(r.id).roundness).toBeNull();
    expect(next.get(r.id).link).toBeNull();
    const t2 = next.get(t.id) as ExcalidrawTextElement;
    expect(t2.fontFamily).toBe(3);
    expect(t2.height).toBeGreaterThan(t.height); // re-measured at the new size
  });

  it("refuses unsafe links, roundness on text and unknown fonts", () => {
    const { api } = stubApi([]);
    const fail = (element: unknown, re: RegExp) =>
      expect(() => applyOps(api, [{ op: "add", element }])).toThrow(re);
    fail({ type: "rectangle", link: `${"java"}script:alert(1)` }, /link/);
    fail({ type: "rectangle", link: " DATA:text/html,x" }, /link/);
    fail({ type: "text", text: "a", roundness: "round" }, /not valid on text/);
    fail(
      { type: "text", text: "a", fontFamily: "Comic Sans" },
      /must be one of/,
    );
    fail({ type: "rectangle", angle: 7 }, /angle/);
  });
});

describe("limits", () => {
  it("uses maxOps clamped to 1..1000", () => {
    const { api } = stubApi([]);
    const ops = (n: number) =>
      Array.from({ length: n }, () => ({
        op: "add",
        element: { type: "rectangle" },
      }));
    expect(() => applyOps(api, ops(3), { maxOps: 2 })).toThrow(/at most 2 ops/);
    expect(() => applyOps(api, ops(501))).toThrow(/at most 500 ops/);
    expect(() => applyOps(api, ops(1001), { maxOps: 5000 })).toThrow(
      /at most 1000 ops/,
    );
  });
});

describe("sceneDetails", () => {
  it("returns rich copies in the order asked, points and data only on request", () => {
    const { result, out } = run([
      box("a", 0, "A"),
      box("b", 300),
      {
        op: "add",
        ref: "ab",
        element: {
          type: "arrow",
          start: { ref: "a" },
          end: { ref: "b" },
          data: { kind: "edge" },
        },
      },
      { op: "group", ids: [{ ref: "a" }, { ref: "b" }] },
    ]);
    const [arrow, a] = sceneDetails(
      out,
      [result.refs.ab, result.refs.a, "missing", result.refs.a],
      {},
      KEY,
    );
    expect(arrow.id).toBe(result.refs.ab);
    expect(arrow.points).toBeUndefined();
    expect(arrow.data).toBeUndefined();
    expect(a.groupIds).toHaveLength(1);
    expect(a.roundness).toBeDefined();
    expect(a).toMatchObject({
      frameId: null,
      containerId: null,
      locked: false,
    });
    const [full] = sceneDetails(
      out,
      [result.refs.ab],
      { points: true, data: true },
      KEY,
    );
    expect(full.points!.length).toBeGreaterThanOrEqual(2);
    expect(full.data).toEqual({ kind: "edge" });
    expect(
      sceneDetails(out, [result.refs.ab], { data: true }, null)[0].data,
    ).toBeUndefined();
  });
});
