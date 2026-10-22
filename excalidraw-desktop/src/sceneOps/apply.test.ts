import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { describe, expect, it } from "vitest";

import { applyOps } from "./apply";
import { makeElements, stubApi } from "./testUtils";
import { SceneOpsError } from "./types";

describe("applyOps", () => {
  it("calls updateScene exactly once with IMMEDIATELY and returns add ids in order", () => {
    const els = makeElements(2);
    const { api, updateScene } = stubApi(els);
    const { ids } = applyOps(api, [
      { op: "add", element: { type: "rectangle", width: 10, height: 10 } },
      { op: "update", id: els[0].id, props: { x: 77, strokeColor: "red" } },
      {
        op: "add",
        element: { type: "rectangle", width: 10, height: 10, text: "label" },
      },
      { op: "delete", id: els[1].id },
    ]);
    expect(updateScene).toHaveBeenCalledTimes(1);
    const arg = updateScene.mock.calls[0][0];
    expect(arg.captureUpdate).toBe(CaptureUpdateAction.IMMEDIATELY);
    const out = arg.elements as typeof els;
    expect(ids).toHaveLength(2);
    expect(out.find((e) => e.id === ids[1])?.type).toBe("rectangle");
    expect(out.find((e) => e.id === els[0].id)).toMatchObject({
      x: 77,
      strokeColor: "red",
    });
    expect(out.find((e) => e.id === els[1].id)?.isDeleted).toBe(true);
    expect(out.every((e) => typeof e.index === "string")).toBe(true);
    expect(els[0].x).not.toBe(77); // inputs untouched
  });

  it("updates text with re-measured size", () => {
    const [t] = makeElements(0);
    const { api, updateScene } = stubApi();
    const { ids } = applyOps(api, [
      { op: "add", element: { type: "text", text: "a" } },
    ]);
    const added = updateScene.mock.calls[0][0].elements[0];
    const { api: api2, updateScene: up2 } = stubApi([added]);
    applyOps(api2, [
      { op: "update", id: ids[0], props: { text: "a much longer line" } },
    ]);
    const next = up2.mock.calls[0][0].elements[0];
    expect(next.text).toBe("a much longer line");
    expect(next.width).toBeGreaterThan(added.width);
    expect(t).toBeUndefined();
  });

  it("writes nothing when any op is invalid", () => {
    const { api, updateScene } = stubApi(makeElements(1));
    expect(() =>
      applyOps(api, [
        { op: "add", element: { type: "rectangle" } },
        { op: "delete", id: "nope" },
      ]),
    ).toThrow(SceneOpsError);
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("centres unplaced adds on the viewport", () => {
    const { api, updateScene } = stubApi([], {
      scrollX: -100,
      zoom: { value: 1 } as never,
    });
    applyOps(api, [
      { op: "add", element: { type: "rectangle", width: 100, height: 100 } },
    ]);
    const el = updateScene.mock.calls[0][0].elements[0];
    expect(el.x + el.width / 2).toBe(600);
    expect(el.y + el.height / 2).toBe(300);
  });
});
