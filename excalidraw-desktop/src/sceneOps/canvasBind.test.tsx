/** API revision 0.9.0: arrows bind to elements already on the canvas (`{ id }`). */
import { Excalidraw } from "@excalidraw/excalidraw";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { describe, expect, it } from "vitest";

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { applyOps } from "./apply";
import { stubApi } from "./testUtils";
import { SceneOpsError } from "./types";

import type { SceneOp } from "./types";

/** Two boxes on the canvas (A at x 0, B at x 300), a free text and a labelled box. */
const canvas = (): ExcalidrawElement[] =>
  convertToExcalidrawElements(
    [
      { type: "rectangle", id: "A", x: 0, y: 0, width: 100, height: 60 },
      { type: "rectangle", id: "B", x: 300, y: 0, width: 100, height: 60 },
      { type: "line", id: "L", x: 0, y: 200, width: 50, height: 0 },
      {
        type: "rectangle",
        id: "C",
        x: 0,
        y: 400,
        width: 100,
        height: 60,
        label: { text: "C" },
      },
    ],
    { regenerateIds: false },
  ) as ExcalidrawElement[];

const run = (ops: SceneOp[], els = canvas()) => {
  const { api, updateScene } = stubApi(els);
  const result = applyOps(api, ops);
  expect(updateScene).toHaveBeenCalledTimes(1);
  const out = updateScene.mock.calls[0][0].elements as ExcalidrawElement[];
  const get = (id: string) => out.find((e) => e.id === id)!;
  return { result, out, get, els };
};

const issues = (ops: unknown, els = canvas()) => {
  const { api, updateScene } = stubApi(els);
  try {
    applyOps(api, ops);
  } catch (e) {
    expect(e).toBeInstanceOf(SceneOpsError);
    expect(updateScene).not.toHaveBeenCalled();
    return (e as SceneOpsError).issues.map((i) => `${i.key}: ${i.message}`);
  }
  throw new Error("expected a rejection");
};

const arrow = (start?: object, end?: object, ref = "ar"): SceneOp =>
  ({
    op: "add",
    ref,
    element: {
      type: "arrow",
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
    },
  } as SceneOp);

const binds = (el: ExcalidrawElement, arrowId: string) =>
  el.boundElements?.some((b) => b.id === arrowId && b.type === "arrow");

describe("binding to elements on the canvas", () => {
  it("binds both ends, updates both targets and draws between them", () => {
    const { result, get, els } = run([arrow({ id: "A" }, { id: "B" })]);
    const a = get(result.refs.ar) as ExcalidrawArrowElement;
    expect(a.startBinding?.elementId).toBe("A");
    expect(a.endBinding?.elementId).toBe("B");
    expect(binds(get("A"), a.id)).toBe(true);
    expect(binds(get("B"), a.id)).toBe(true);
    // The editor's own elements are never changed in place.
    expect(els.find((e) => e.id === "A")!.boundElements ?? []).toEqual([]);
    expect(get("A").version).toBeGreaterThan(
      els.find((e) => e.id === "A")!.version,
    );
    const x1 = a.x;
    const x2 = a.x + a.points[a.points.length - 1][0];
    expect(x1).toBeGreaterThanOrEqual(95);
    expect(x2).toBeLessThanOrEqual(305);
    expect(x2).toBeGreaterThan(x1);
  });

  it("mixes a new element (ref) with one on the canvas (id)", () => {
    const { result, get } = run([
      {
        op: "add",
        ref: "n",
        element: { type: "ellipse", x: 0, y: 300, width: 80, height: 80 },
      },
      arrow({ ref: "n" }, { id: "B" }),
    ]);
    const a = get(result.refs.ar) as ExcalidrawArrowElement;
    expect(a.startBinding?.elementId).toBe(result.refs.n);
    expect(a.endBinding?.elementId).toBe("B");
    expect(binds(get(result.refs.n), a.id)).toBe(true);
    expect(binds(get("B"), a.id)).toBe(true);
  });

  it("keeps the target's other bound elements (its label and earlier arrows)", () => {
    const first = run([arrow({ id: "C" }, { id: "B" }, "one")]);
    const second = run([arrow({ id: "A" }, { id: "C" }, "two")], first.out);
    const c = second.get("C");
    expect(c.boundElements?.map((b) => b.type).sort()).toEqual([
      "arrow",
      "arrow",
      "text",
    ]);
  });

  it("an arrow bound only to the canvas is not centred with the rest of the batch", () => {
    const { result, get } = run(
      [
        { op: "add", ref: "t", element: { type: "text", text: "note" } },
        arrow({ id: "A" }, { id: "B" }),
      ],
      canvas(),
    );
    // The text alone is centred on the viewport (1000 x 600 → 500, 300).
    const t = get(result.refs.t);
    expect(t.x + t.width / 2).toBeCloseTo(500, 0);
    expect(t.y + t.height / 2).toBeCloseTo(300, 0);
    // The arrow still runs between A and B.
    const a = get(result.refs.ar) as ExcalidrawArrowElement;
    expect(a.x).toBeGreaterThanOrEqual(95);
    expect(a.y).toBeLessThan(60);
  });

  it("a one-ended arrow to the canvas is a stub beside the shape", () => {
    const { result, get } = run([arrow(undefined, { id: "B" })]);
    const a = get(result.refs.ar) as ExcalidrawArrowElement;
    expect(a.startBinding).toBeNull();
    expect(a.endBinding?.elementId).toBe("B");
    expect(a.x).toBeLessThan(300);
  });

  it("binds to a shape moved earlier in the same batch, at its new place", () => {
    const { result, get } = run([
      { op: "update", id: "B", props: { x: 600 } },
      arrow({ id: "A" }, { id: "B" }),
    ]);
    const a = get(result.refs.ar) as ExcalidrawArrowElement;
    expect(get("B").x).toBe(600);
    expect(binds(get("B"), a.id)).toBe(true);
    expect(a.x + a.points[a.points.length - 1][0]).toBeGreaterThan(500);
  });

  it("refuses missing, deleted, unbindable, label and same-element targets", () => {
    expect(issues([arrow({ id: "nope" })])).toEqual(["start: no such element"]);
    expect(
      issues([{ op: "delete", id: "A" }, arrow({ id: "A" }, { id: "B" })]),
    ).toEqual(["start: element was deleted earlier in this batch"]);
    expect(
      issues([arrow({ id: "A" }, { id: "B" }), { op: "delete", id: "B" }]),
    ).toEqual(["end: element is deleted later in this batch"]);
    expect(issues([arrow({ id: "L" })])[0]).toMatch(/binds only to/);
    const withLabel = canvas();
    const label = withLabel.find(
      (e) => e.type === "text" && (e as { containerId?: string }).containerId,
    )!;
    expect(issues([arrow({ id: label.id })], withLabel)[0]).toMatch(
      /is a label/,
    );
    expect(issues([arrow({ id: "A" }, { id: "A" })])).toEqual([
      "end: start and end must name different elements",
    ]);
    expect(issues([arrow({ id: "A", ref: "x" })])[0]).toMatch(
      /^start: must be \{ ref \}/,
    );
    const locked = canvas().map((e) =>
      e.id === "A" ? { ...e, locked: true } : e,
    );
    expect(issues([arrow({ id: "A" })], locked)[0]).toMatch(/is locked/);
    const gone = canvas().map((e) =>
      e.id === "A" ? { ...e, isDeleted: true } : e,
    );
    expect(issues([arrow({ id: "A" })], gone)).toEqual([
      "start: no such element",
    ]);
  });

  it("only the named targets are copied (the cost follows the batch)", () => {
    const many = canvas();
    const { out, els } = run([arrow({ id: "A" }, { id: "B" })], many);
    const changed = out.filter((e) => !els.includes(e)).map((e) => e.id);
    // The new arrow and the two targets; every other element is the same object.
    expect(changed.filter((id) => id !== "A" && id !== "B")).toHaveLength(1);
  });
});

describe("in the real editor", () => {
  it("one undo removes the arrow and both bindings", async () => {
    let api!: ExcalidrawImperativeAPI;
    render(
      <div style={{ width: 800, height: 600 }}>
        <Excalidraw
          handleKeyboardGlobally
          onExcalidrawAPI={(a) => {
            if (a) {
              api = a;
            }
          }}
        />
      </div>,
    );
    await waitFor(() => expect(api).toBeTruthy());
    act(() => {
      applyOps(api, [
        {
          op: "add",
          ref: "a",
          element: { type: "rectangle", x: 0, y: 0, width: 100, height: 60 },
        },
        {
          op: "add",
          ref: "b",
          element: { type: "rectangle", x: 300, y: 0, width: 100, height: 60 },
        },
      ]);
    });
    const [a, b] = api.getSceneElements().map((e) => e.id);
    let arrowId!: string;
    act(() => {
      arrowId = applyOps(api, [arrow({ id: a }, { id: b })]).ids[0];
    });
    const live = (id: string) =>
      api.getSceneElements().find((e) => e.id === id);
    expect(live(a)?.boundElements?.some((x) => x.id === arrowId)).toBe(true);
    expect(live(b)?.boundElements?.some((x) => x.id === arrowId)).toBe(true);

    act(() => {
      fireEvent.keyDown(document, { key: "z", code: "KeyZ", ctrlKey: true });
    });
    expect(live(arrowId)).toBeUndefined();
    expect(live(a)?.boundElements ?? []).toEqual([]);
    expect(live(b)?.boundElements ?? []).toEqual([]);
    expect(api.getSceneElements()).toHaveLength(2);
  });
});
