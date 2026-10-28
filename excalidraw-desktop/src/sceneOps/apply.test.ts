import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";

import {
  DEFAULT_PAGE_SETUP,
  PAGE_LIMITS,
} from "@excalidraw/excalidraw/data/pageSetup";
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { applyOps } from "./apply";
import { makeElements, stubApi } from "./testUtils";
import { SceneOpsError } from "./types";

describe("applyOps pageCount", () => {
  const add = [
    { op: "add", element: { type: "rectangle", width: 10, height: 10 } },
  ] as const;

  it("sets the page count in the same update in page mode", () => {
    const pageSetup = { ...DEFAULT_PAGE_SETUP, enabled: true, pageCount: 1 };
    const { api, updateScene } = stubApi([], { pageSetup });
    applyOps(api, add, { pageCount: 4 });
    expect(updateScene).toHaveBeenCalledTimes(1);
    expect(updateScene.mock.calls[0][0].appState.pageSetup.pageCount).toBe(4);
  });

  it("clamps to the page limit and is ignored outside page mode", () => {
    const pageSetup = { ...DEFAULT_PAGE_SETUP, enabled: true, pageCount: 1 };
    const on = stubApi([], { pageSetup });
    applyOps(on.api, add, { pageCount: 9999 });
    expect(on.updateScene.mock.calls[0][0].appState.pageSetup.pageCount).toBe(
      PAGE_LIMITS.pageCount.max,
    );
    const off = stubApi([]);
    applyOps(off.api, add, { pageCount: 4 });
    expect(off.updateScene.mock.calls[0][0].appState).toBeUndefined();
  });
});

describe("applyOps reveal", () => {
  const add = [
    {
      op: "add",
      element: { type: "rectangle", x: 100, y: 500, width: 200, height: 80 },
    },
  ] as const;

  it("scrolls the first added element to the top-centre, in the same update, without zoom", () => {
    const { api, updateScene } = stubApi([], { zoom: { value: 2 } as never });
    applyOps(api, add, { reveal: true });
    const { appState } = updateScene.mock.calls[0][0];
    // view 1000 wide at zoom 2: centre = 250 scene units; top margin 24 px = 12 units
    expect(appState).toEqual({ scrollX: 250 - 200, scrollY: 12 - 500 });
  });

  it("is ignored in page mode and when off", () => {
    const pageSetup = { ...DEFAULT_PAGE_SETUP, enabled: true, pageCount: 1 };
    const on = stubApi([], { pageSetup });
    applyOps(on.api, add, { reveal: true });
    expect(on.updateScene.mock.calls[0][0].appState).toBeUndefined();
    const off = stubApi([]);
    applyOps(off.api, add);
    expect(off.updateScene.mock.calls[0][0].appState).toBeUndefined();
  });
});

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

  it("recomputes an arrow's size when its points change", () => {
    const [arrow] = convertToExcalidrawElements([
      {
        type: "arrow",
        x: 0,
        y: 0,
        points: [
          [0, 0],
          [10, 5],
        ],
      },
    ] as never) as ExcalidrawElement[];
    const { api, updateScene } = stubApi([arrow]);
    applyOps(api, [
      {
        op: "update",
        id: arrow.id,
        props: {
          points: [
            [0, 0],
            [120, 40],
            [200, -10],
          ],
        },
      },
    ]);
    const next = updateScene.mock.calls[0][0].elements[0];
    expect(next.points).toHaveLength(3);
    expect(next.width).toBe(200);
    expect(next.height).toBe(50);
  });

  it("wraps bound label text and grows its container", () => {
    const [box, label] = convertToExcalidrawElements([
      {
        type: "rectangle",
        x: 0,
        y: 0,
        width: 120,
        height: 60,
        label: { text: "hi" },
      },
    ] as never) as ExcalidrawElement[];
    expect(label.type).toBe("text");
    const { api, updateScene } = stubApi([box, label]);
    const long = "a long label that has to wrap over many lines inside the box";
    applyOps(api, [{ op: "update", id: label.id, props: { text: long } }]);
    const out = updateScene.mock.calls[0][0].elements as ExcalidrawElement[];
    const nb = out.find((e) => e.id === box.id)!;
    const nl = out.find((e) => e.id === label.id) as ExcalidrawElement & {
      text: string;
      originalText: string;
    };
    expect(nl.originalText).toBe(long);
    expect(nl.text).toContain("\n"); // wrapped to the container width
    expect(nb.height).toBeGreaterThan(box.height); // container grew to fit
    expect(nl.y).toBeGreaterThanOrEqual(nb.y); // label stays inside
    expect(nl.y + nl.height).toBeLessThanOrEqual(nb.y + nb.height);
  });
});
