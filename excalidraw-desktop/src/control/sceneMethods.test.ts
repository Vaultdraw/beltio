import { describe, expect, it, vi } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { projectScene } from "../sceneOps";
import { makeElements } from "../sceneOps/testUtils";

import { createSceneMethods } from "./sceneMethods";
import { sceneVersion } from "./sceneVersion";

import type { ControlError } from "./errors";

import type { ActiveScene } from "../sceneOps/sceneBus";

/** A stateful fake editor: updateScene replaces the elements, like the real one. */
const fakeScene = (
  initial: ExcalidrawElement[] = makeElements(5),
  over: Partial<ActiveScene> = {},
  appState: Record<string, unknown> = {},
) => {
  let els = initial;
  const updateScene = vi.fn((s: { elements: ExcalidrawElement[] }) => {
    els = s.elements;
  });
  const state = {
    scrollX: 0,
    scrollY: 0,
    width: 1000,
    height: 600,
    zoom: { value: 1 },
    selectedElementIds: {},
    ...appState,
  };
  const scene = {
    api: {
      getAppState: () => state,
      getSceneElementsIncludingDeleted: () => els,
      updateScene,
    },
    path: "notes/plan.excalidraw",
    readOnly: false,
    ...over,
  } as unknown as ActiveScene;
  return { scene, updateScene, state, els: () => els };
};

const setup = (fake = fakeScene(), withScene = true) => {
  const notify = vi.fn();
  const m = createSceneMethods({
    active: () => (withScene ? fake.scene : null),
    notify,
  });
  return { m, notify, ...fake };
};

const fail = (fn: () => unknown): ControlError => {
  try {
    fn();
  } catch (e) {
    return e as ControlError;
  }
  throw new Error("expected a ControlError");
};

const rect = {
  op: "add",
  element: { type: "rectangle", width: 10, height: 10 },
};

describe("scene methods: common errors", () => {
  it.each(["scene.read", "scene.get", "scene.selection", "scene.apply"])(
    "%s without a drawing is NOT_FOUND no_drawing",
    (name) => {
      const { m } = setup(fakeScene(), false);
      const e = fail(() => m[name]({ ids: ["a"], ops: [rect] }));
      expect(e).toMatchObject({
        code: "NOT_FOUND",
        data: { reason: "no_drawing" },
      });
    },
  );

  it.each(["scene.read", "scene.get", "scene.selection", "scene.apply"])(
    "%s with another path is NOT_FOUND not_active",
    (name) => {
      const { m } = setup();
      const e = fail(() =>
        m[name]({ path: "other.excalidraw", ids: ["a"], ops: [rect] }),
      );
      expect(e).toMatchObject({
        code: "NOT_FOUND",
        data: { reason: "not_active", path: "other.excalidraw" },
      });
    },
  );

  it("the active path is accepted", () => {
    const { m } = setup();
    const r = m["scene.selection"]({ path: "notes/plan.excalidraw" }) as any;
    expect(r.path).toBe("notes/plan.excalidraw");
  });

  it("non-object params and a bad path type are INVALID_PARAMS", () => {
    const { m } = setup();
    expect(fail(() => m["scene.read"](null)).code).toBe("INVALID_PARAMS");
    expect(fail(() => m["scene.read"]({ path: 3 })).code).toBe(
      "INVALID_PARAMS",
    );
  });
});

describe("scene.read", () => {
  it("returns the projection, version, counts, viewport and selection", () => {
    const f = fakeScene(makeElements(3));
    const els = f.els();
    f.state.selectedElementIds = { [els[1].id]: true } as never;
    f.state.scrollX = -100;
    f.state.zoom = { value: 2 };
    const { m } = setup(f);
    const r = m["scene.read"]({}) as any;
    expect(r).toMatchObject({
      path: "notes/plan.excalidraw",
      live: true,
      readOnly: false,
      total: 3,
      returned: 3,
      truncated: false,
      counts: { rectangle: 3 },
      selection: [els[1].id],
      viewport: { x: 100, y: -0, width: 500, height: 300, zoom: 2 },
    });
    expect(r.version).toBe(sceneVersion(els));
    expect(r.elements).toEqual(projectScene(els));
  });

  it("ignores deleted elements", () => {
    const els = makeElements(3);
    const f = fakeScene([
      els[0],
      { ...els[1], isDeleted: true },
      els[2],
    ] as ExcalidrawElement[]);
    const r = setup(f).m["scene.read"]({}) as any;
    expect(r.total).toBe(2);
  });

  it("filters by types and ids, counts after filters", () => {
    const f = fakeScene(makeElements(4));
    const { m, scene } = setup(f);
    const els = f.els();
    const ids = [els[0].id, els[2].id];
    const r = m["scene.read"]({ ids }) as any;
    expect(r.elements.map((e: any) => e.id)).toEqual(ids);
    expect(r.total).toBe(2);
    expect((m["scene.read"]({ types: ["ellipse"] }) as any).total).toBe(0);
    expect(
      (m["scene.read"]({ types: ["rectangle"], ids }) as any).counts,
    ).toEqual({
      rectangle: 2,
    });
    void scene;
  });

  it("scope selection returns only selected elements", () => {
    const f = fakeScene(makeElements(4));
    f.state.selectedElementIds = { [f.els()[3].id]: true } as never;
    const r = setup(f).m["scene.read"]({ scope: "selection" }) as any;
    expect(r.elements.map((e: any) => e.id)).toEqual([f.els()[3].id]);
  });

  it("scope viewport keeps elements whose box meets the visible rectangle", () => {
    // makeElements: 100x80 boxes at x = i*120. Viewport is 1000 wide at scroll 0: x 0..1000.
    const f = fakeScene(makeElements(12));
    const r = setup(f).m["scene.read"]({ scope: "viewport" }) as any;
    expect(r.total).toBe(9); // x = 0..960 start inside 0..1000; 1080 does not
    f.state.scrollX = -1000; // visible x 1000..2000
    const r2 = setup(f).m["scene.read"]({ scope: "viewport" }) as any;
    expect(r2.elements[0].x).toBe(960); // 960..1060 still touches 1000
    expect(r2.total).toBe(4);
  });

  it("pages with limit and offset; total stays before paging", () => {
    const f = fakeScene(makeElements(10));
    const { m } = setup(f);
    const a = m["scene.read"]({ limit: 4 }) as any;
    expect([a.total, a.returned, a.truncated]).toEqual([10, 4, true]);
    const b = m["scene.read"]({ limit: 4, offset: 8 }) as any;
    expect([b.total, b.returned, b.truncated]).toEqual([10, 2, false]);
    expect(b.elements[0].id).toBe(f.els()[8].id);
    expect((m["scene.read"]({ offset: 50 }) as any).returned).toBe(0);
  });

  it.each([
    [{ scope: "everything" }],
    [{ types: "rectangle" }],
    [{ types: [1] }],
    [{ ids: [""] }],
    [{ limit: 0 }],
    [{ limit: 2001 }],
    [{ limit: 1.5 }],
    [{ limit: "5" }],
    [{ offset: -1 }],
    [{ offset: "1" }],
  ])("bad params %j are INVALID_PARAMS", (p) => {
    expect(fail(() => setup().m["scene.read"](p)).code).toBe("INVALID_PARAMS");
  });

  it("reports readOnly", () => {
    const r = setup(fakeScene(makeElements(1), { readOnly: true })).m[
      "scene.read"
    ]({}) as any;
    expect(r.readOnly).toBe(true);
  });
});

describe("scene.get and scene.selection", () => {
  it("get returns found elements in request order and lists missing ids", () => {
    const f = fakeScene(makeElements(3));
    const [a, b] = f.els();
    const r = setup(f).m["scene.get"]({ ids: [b.id, "nope", a.id] }) as any;
    expect(r.elements.map((e: any) => e.id)).toEqual([b.id, a.id]);
    expect(r.missing).toEqual(["nope"]);
    expect(r.version).toBe(sceneVersion(f.els()));
  });

  it("get treats deleted elements as missing", () => {
    const els = makeElements(2);
    const f = fakeScene([
      { ...els[0], isDeleted: true },
      els[1],
    ] as ExcalidrawElement[]);
    const r = setup(f).m["scene.get"]({ ids: [els[0].id] }) as any;
    expect(r.missing).toEqual([els[0].id]);
  });

  it.each([
    [{}],
    [{ ids: [] }],
    [{ ids: "a" }],
    [{ ids: [1] }],
    [{ ids: Array(101).fill("a") }],
  ])("get with bad ids %j is INVALID_PARAMS", (p) => {
    expect(fail(() => setup().m["scene.get"](p)).code).toBe("INVALID_PARAMS");
  });

  it("selection lists ids and elements, empty when nothing is selected", () => {
    const f = fakeScene(makeElements(3));
    const { m } = setup(f);
    expect((m["scene.selection"]({}) as any).ids).toEqual([]);
    f.state.selectedElementIds = {
      [f.els()[2].id]: true,
      ghost: true,
    } as never;
    const r = m["scene.selection"]({}) as any;
    expect(r.ids).toEqual([f.els()[2].id]);
    expect(r.elements).toHaveLength(1);
  });
});

describe("scene.apply", () => {
  it("writes once and returns ids and the version after the write", () => {
    const { m, updateScene, els } = setup();
    const before = els().length;
    const r = m["scene.apply"]({ ops: [rect, rect, rect] }) as any;
    expect(updateScene).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({
      path: "notes/plan.excalidraw",
      live: true,
      applied: 3,
    });
    expect(r.ids).toHaveLength(3);
    expect(els()).toHaveLength(before + 3);
    expect(r.version).toBe(sceneVersion(els()));
  });

  it("updates and deletes existing elements by id", () => {
    const { m, els } = setup();
    const [a, b] = els();
    m["scene.apply"]({
      ops: [
        { op: "update", id: a.id, props: { x: 77 } },
        { op: "delete", id: b.id },
      ],
    });
    expect(els().find((e) => e.id === a.id)?.x).toBe(77);
    expect(els().find((e) => e.id === b.id)?.isDeleted).toBe(true);
  });

  it("ifVersion that matches applies; a stale one is CONFLICT and writes nothing", () => {
    const { m, updateScene, els } = setup();
    const current = sceneVersion(els());
    m["scene.apply"]({ ops: [rect], ifVersion: current });
    expect(updateScene).toHaveBeenCalledTimes(1);
    const e = fail(() => m["scene.apply"]({ ops: [rect], ifVersion: current }));
    expect(e.code).toBe("CONFLICT");
    expect(e.data).toEqual({ reason: "version", current: sceneVersion(els()) });
    expect(updateScene).toHaveBeenCalledTimes(1);
  });

  it("dry run validates, writes nothing, sends no notice", () => {
    const { m, updateScene, notify, els } = setup();
    const v = sceneVersion(els());
    const r = m["scene.apply"]({ ops: [rect], dryRun: true }) as any;
    expect(r).toEqual({
      path: "notes/plan.excalidraw",
      live: true,
      dryRun: true,
      applied: 0,
      valid: true,
      version: v,
    });
    expect(updateScene).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("dry run reports invalid ops as INVALID_PARAMS with issues", () => {
    const { m, updateScene } = setup();
    const e = fail(() =>
      m["scene.apply"]({
        ops: [{ op: "delete", id: "missing" }],
        dryRun: true,
      }),
    );
    expect(e.code).toBe("INVALID_PARAMS");
    expect((e.data as any).issues[0]).toMatchObject({ op: 0 });
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("dry run honours ifVersion", () => {
    const { m } = setup();
    expect(
      fail(() =>
        m["scene.apply"]({ ops: [rect], dryRun: true, ifVersion: "sxx" }),
      ).code,
    ).toBe("CONFLICT");
  });

  it("invalid ops: INVALID_PARAMS with every issue, nothing written, no notice", () => {
    const { m, updateScene, notify } = setup();
    const e = fail(() =>
      m["scene.apply"]({
        ops: [
          { op: "add", element: { type: "star" } },
          { op: "update", id: "nope", props: { x: 1 } },
        ],
      }),
    );
    expect(e.code).toBe("INVALID_PARAMS");
    expect((e.data as any).issues.length).toBeGreaterThanOrEqual(2);
    expect(updateScene).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("read-only drawing is READ_ONLY", () => {
    const { m, updateScene } = setup(
      fakeScene(makeElements(1), { readOnly: true }),
    );
    expect(fail(() => m["scene.apply"]({ ops: [rect] })).code).toBe(
      "READ_ONLY",
    );
    expect(updateScene).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ ops: "x" }],
    [{ ops: [] }],
    [{ ops: Array(501).fill(rect) }],
    [{ ops: [rect], ifVersion: 5 }],
    [{ ops: [rect], ifVersion: "" }],
    [{ ops: [rect], dryRun: "yes" }],
    [{ ops: [rect], notify: 1 }],
    [{ ops: [rect], by: "robot" }],
  ])("bad params %j are INVALID_PARAMS", (p) => {
    const { m, updateScene } = setup();
    expect(fail(() => m["scene.apply"](p)).code).toBe("INVALID_PARAMS");
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("accepts 500 ops (the limit)", () => {
    const { m } = setup();
    const r = m["scene.apply"]({ ops: Array(500).fill(rect) }) as any;
    expect(r.applied).toBe(500);
  });

  describe("notice", () => {
    it.each([
      ["cli", "A script made 3 changes to plan. Undo reverts them."],
      ["mcp", "AI tools made 3 changes to plan. Undo reverts them."],
      ["uri", "The control API made 3 changes to plan. Undo reverts them."],
      [undefined, "The control API made 3 changes to plan. Undo reverts them."],
    ])("by %s", (by, text) => {
      const { m, notify } = setup();
      m["scene.apply"]({ ops: [rect, rect, rect], by });
      expect(notify).toHaveBeenCalledExactlyOnceWith(text);
    });

    it("one change reads naturally", () => {
      const { m, notify } = setup();
      m["scene.apply"]({ ops: [rect], by: "cli" });
      expect(notify).toHaveBeenCalledWith(
        "A script made 1 change to plan. Undo reverts it.",
      );
    });

    it("notify:false is silent", () => {
      const { m, notify } = setup();
      m["scene.apply"]({ ops: [rect], notify: false });
      expect(notify).not.toHaveBeenCalled();
    });

    it("uses the file name without the extension, and a fallback for an unsaved drawing", () => {
      const a = setup(
        fakeScene(makeElements(1), { path: "a/b/My Plan.excalidraw" }),
      );
      a.m["scene.apply"]({ ops: [rect] });
      expect(a.notify.mock.calls[0][0]).toContain(
        "changes to My Plan.".replace("changes", "change"),
      );
      const b = setup(fakeScene(makeElements(1), { path: null }));
      b.m["scene.apply"]({ ops: [rect] });
      expect(b.notify.mock.calls[0][0]).toContain("to the drawing.");
    });
  });
});
