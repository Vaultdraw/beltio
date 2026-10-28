import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { AFTER_AUTOSAVE_MS } from "./constants";
import {
  canvasBox,
  exportedNames,
  exportDialogButton,
  openDrawing,
  openExportDialogFromMenu,
  openVault,
  readScene,
  trackErrors,
} from "./helpers";
import { seedAndOpen, toClient } from "./pageHelpers";

/**
 * Canvas and shapes, in a few data-driven tests that each check many things in
 * one pass (owner, 2026-10-28: "have each test think about everything"):
 *
 *   1. tools:    every tool, negative / tiny / click-only / off-canvas drags,
 *                undo and redo of all of it, save and reopen
 *   2. binding:  arrow bind, move target, delete target, undo; frames with
 *                children, arrow inside, move, resize, add, remove
 *   3. editing:  groups and nested groups, Alt-drag, duplicate, paste, nudge,
 *                lock, z-order, align, distribute, undo/redo of each
 *   4. text:     empty, huge, unicode, right-to-left, emoji, multi-line, font,
 *                text in a container, saved and reopened
 *   5. view:     zoom 10% and 3000%, pan, theme, very large and very small
 *                shapes, SVG and PNG export, save and reopen
 *
 * Every test draws with the real mouse and keyboard through the visible
 * toolbar and panels, and ends with no console error.
 */
test.describe.configure({ mode: "parallel" });
test.setTimeout(120_000);

const FILE = "Canvas.excalidraw";

type El = Record<string, any>;
type Snap = {
  els: El[];
  sel: string[];
  selGroups: string[];
  editingGroupId: string | null;
  zoom: number;
  scrollX: number;
  scrollY: number;
  theme: string;
  tool: string;
  editing: string | null;
};

/** Full live scene and the editor's state (found through React's fibers). */
const snap = (page: Page): Promise<Snap> =>
  page.evaluate(() => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
    let fiber = (el as any)[key];
    while (fiber) {
      const s = fiber.stateNode;
      if (s && s.state && s.scene && typeof s.state.scrollX === "number") {
        const st = s.state;
        return JSON.parse(
          JSON.stringify({
            els: s.scene.getNonDeletedElements(),
            sel: Object.keys(st.selectedElementIds ?? {}).filter(
              (k) => st.selectedElementIds[k],
            ),
            selGroups: Object.keys(st.selectedGroupIds ?? {}).filter(
              (k) => st.selectedGroupIds[k],
            ),
            editingGroupId: st.editingGroupId ?? null,
            zoom: st.zoom.value,
            scrollX: st.scrollX,
            scrollY: st.scrollY,
            theme: st.theme,
            tool: st.activeTool.type,
            editing: st.editingTextElement?.id ?? null,
          }),
        );
      }
      fiber = fiber.return;
    }
    throw new Error("editor instance not found");
  });

const els = async (page: Page) => (await snap(page)).els;
const last = async (page: Page) => (await els(page)).at(-1)!;
const count = async (page: Page) => (await els(page)).length;
const byId = async (page: Page, id: string) =>
  (await els(page)).find((e) => e.id === id)!;

const near = (a: number, b: number, tol = 1.5, what = "") =>
  expect(Math.abs(a - b), `${what} ${a} vs ${b}`).toBeLessThanOrEqual(tol);

const finite = (e: El, what: string) => {
  for (const k of ["x", "y", "width", "height"]) {
    expect(Number.isFinite(e[k]), `${what}.${k} is finite (${e[k]})`).toBe(
      true,
    );
  }
};

/** Elbow arrows are elbowed, plain arrows not; one place for the Arrow type panel. */
const setArrowType = async (page: Page, type: "sharp" | "round" | "elbow") => {
  const trigger = page.locator(
    "section.selected-shape-actions button[title='Arrow type']",
  );
  await trigger.click();
  await page.getByTestId(`${type}-arrow`).first().click({ force: true });
  await trigger.click();
};

const selectTool = async (page: Page, tool: string) => {
  if (tool === "freedraw") {
    await page.keyboard.press("p");
  } else if (tool === "frame" || tool === "embeddable") {
    await page.locator(".App-toolbar__extra-tools-trigger").click();
    await page
      .getByRole("menuitem", { name: tool === "frame" ? /Frame/ : /embed/i })
      .first()
      .click();
  } else {
    await page.locator(`.vault-editor [data-testid='toolbar-${tool}']`).click();
  }
};

type Pt = [number, number];

/** Drags with the mouse between two scene points (steps keep the pointer events real). */
const drag = async (
  page: Page,
  a: Pt,
  b: Pt,
  o: { alt?: boolean; shift?: boolean; steps?: number } = {},
) => {
  const from = await toClient(page, a[0], a[1]);
  const to = await toClient(page, b[0], b[1]);
  if (o.alt) {
    await page.keyboard.down("Alt");
  }
  if (o.shift) {
    await page.keyboard.down("Shift");
  }
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, {
    steps: o.steps ?? 4,
  });
  await page.mouse.move(to.x, to.y, { steps: o.steps ?? 4 });
  // the editor handles pointer moves once per frame: let the last one land
  await page.waitForTimeout(50);
  await page.mouse.up();
  if (o.shift) {
    await page.keyboard.up("Shift");
  }
  if (o.alt) {
    await page.keyboard.up("Alt");
  }
  await page.waitForTimeout(60);
};

/** The one element that was not there before (frame children sort before their frame). */
const newest = async (page: Page, ids: Set<string>, what: string) => {
  const fresh = (await els(page)).filter((e) => !ids.has(e.id));
  expect(fresh.length, `${what} drawn`).toBe(1);
  return fresh[0];
};

/** Draws with a toolbar tool and returns the new element. */
const draw = async (page: Page, tool: string, a: Pt, b: Pt) => {
  const ids = new Set((await els(page)).map((e) => e.id));
  await selectTool(page, tool);
  await drag(page, a, b);
  if (tool === "embeddable") {
    // a new embeddable opens its link box over the toolbar menu: click away
    await page.keyboard.press("Escape");
    await page.keyboard.press("v");
    const away = await toClient(page, 850, 640);
    await page.mouse.click(away.x, away.y);
  }
  return newest(page, ids, tool);
};

const rectAt = (page: Page, x: number, y: number, w = 100, h = 70) =>
  draw(page, "rectangle", [x, y], [x + w, y + h]);

/** Click on an element's top edge: selects it whatever its fill. */
const clickEdge = async (page: Page, e: El) => {
  await page.keyboard.press("v");
  const c = await toClient(page, e.x + e.width / 2, e.y);
  await page.mouse.click(c.x, c.y);
};

const undo = (page: Page) => page.keyboard.press("Meta+KeyZ");
const redo = (page: Page) => page.keyboard.press("Meta+Shift+KeyZ");

const start = async (page: Page, query = "") => {
  await openVault(page, query);
  if (query.includes("plugins=")) {
    await page.waitForFunction(() => (window as any).__pluginsReady === true);
  }
  await seedAndOpen(page, FILE);
};

/** Waits for the autosave and returns the saved, non-deleted elements. */
const saved = async (page: Page) => {
  await page.waitForTimeout(AFTER_AUTOSAVE_MS + 300);
  return (await readScene(page, FILE)).elements.filter(
    (e: El) => !e.isDeleted,
  ) as El[];
};

/** Leaves the drawing and comes back, which re-reads the saved file. */
const reopen = async (page: Page) => {
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await openDrawing(page, "Canvas");
  await page.waitForTimeout(300);
};

/** Pixels in the static canvases that differ from their corner colour, inside a client box. */
const ink = (
  page: Page,
  box: { x1: number; y1: number; x2: number; y2: number },
) =>
  page.evaluate((b) => {
    let n = 0;
    for (const c of document.querySelectorAll<HTMLCanvasElement>(
      ".vault-editor canvas",
    )) {
      if (c.classList.contains("interactive") || c.width === 0) {
        continue;
      }
      const r = c.getBoundingClientRect();
      const s = c.width / r.width;
      const x0 = Math.max(0, Math.floor((b.x1 - r.left) * s));
      const y0 = Math.max(0, Math.floor((b.y1 - r.top) * s));
      const x1 = Math.min(c.width, Math.ceil((b.x2 - r.left) * s));
      const y1 = Math.min(c.height, Math.ceil((b.y2 - r.top) * s));
      if (x1 <= x0 || y1 <= y0) {
        continue;
      }
      const ctx = c.getContext("2d")!;
      const bg = ctx.getImageData(c.width - 3, c.height - 3, 1, 1).data;
      const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      for (let i = 0; i < d.length; i += 12) {
        const diff =
          Math.abs(d[i] - bg[0]) +
          Math.abs(d[i + 1] - bg[1]) +
          Math.abs(d[i + 2] - bg[2]);
        if (diff > 60) {
          n++;
        }
      }
    }
    return n;
  }, box);

const sceneInk = async (page: Page, e: El, pad = 4) => {
  const a = await toClient(page, e.x, e.y);
  const b = await toClient(page, e.x + e.width, e.y + e.height);
  return ink(page, {
    x1: Math.min(a.x, b.x) - pad,
    y1: Math.min(a.y, b.y) - pad,
    x2: Math.max(a.x, b.x) + pad,
    y2: Math.max(a.y, b.y) + pad,
  });
};

const geom = (e: El) => ({
  id: e.id,
  type: e.type,
  x: Math.round(e.x * 10) / 10,
  y: Math.round(e.y * 10) / 10,
  w: Math.round(e.width * 10) / 10,
  h: Math.round(e.height * 10) / 10,
});

/* ------------------------------------------------------------------ 1 */

test("tools: every tool, tiny / negative / click-only / off-canvas drags, undo and redo, save and reopen", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page, "?plugins=shape-demo");
  const box = await canvasBox(page);

  // 1. every tool, each drawn left-to-right, and again right-to-left / upward
  const plan: { tool: string; type: string }[] = [
    { tool: "rectangle", type: "rectangle" },
    { tool: "diamond", type: "diamond" },
    { tool: "ellipse", type: "ellipse" },
    { tool: "arrow", type: "arrow" },
    { tool: "line", type: "line" },
    { tool: "freedraw", type: "freedraw" },
    { tool: "frame", type: "frame" },
    { tool: "embeddable", type: "embeddable" },
  ];
  for (const [i, p] of plan.entries()) {
    for (const dir of [1, -1]) {
      const cx = 300 + i * 70;
      const cy = dir === 1 ? 200 : 330;
      const a: Pt = dir === 1 ? [cx, cy] : [cx + 56, cy + 40];
      const b: Pt = dir === 1 ? [cx + 56, cy + 40] : [cx, cy];
      const e = await draw(page, p.tool, a, b);
      const what = `${p.tool} dir ${dir}`;
      expect(e.type, what).toBe(p.type);
      finite(e, what);
      if (p.type === "arrow" || p.type === "line") {
        near(e.x, a[0], 1.5, `${what} x is the start`);
        near(e.y, a[1], 1.5, `${what} y is the start`);
        const tip = e.points.at(-1);
        near(tip[0], b[0] - a[0], 1.5, `${what} tip dx`);
        near(tip[1], b[1] - a[1], 1.5, `${what} tip dy`);
      } else if (p.type === "freedraw") {
        // a straight drag is a stroke; its box covers the drag
        expect(e.width + e.height, what).toBeGreaterThan(40);
      } else {
        near(e.x, Math.min(a[0], b[0]), 1.5, `${what} x`);
        near(e.y, Math.min(a[1], b[1]), 1.5, `${what} y`);
        near(e.width, 56, 1.5, `${what} width`);
        near(e.height, 40, 1.5, `${what} height`);
      }
      expect(await sceneInk(page, e), `${what} is painted`).toBeGreaterThan(3);
    }
  }

  // elbow arrow: its own panel type, both directions keep a right-angle path
  await selectTool(page, "arrow");
  await setArrowType(page, "elbow");
  await selectTool(page, "arrow");
  await drag(page, [320, 450], [420, 520]);
  const elbow = await last(page);
  expect(elbow.type).toBe("arrow");
  expect(elbow.elbowed, "elbow arrow is elbowed").toBe(true);
  expect(elbow.points.length, "an elbow arrow bends").toBeGreaterThan(2);
  await selectTool(page, "arrow");
  await drag(page, [620, 520], [520, 450]);
  const elbow2 = await last(page);
  expect(elbow2.elbowed).toBe(true);
  finite(elbow2, "elbow arrow up-left");
  await selectTool(page, "arrow");
  await setArrowType(page, "round");

  // text: click, type, Escape
  await selectTool(page, "text");
  const t = await toClient(page, 700, 450);
  await page.mouse.click(t.x, t.y);
  await page.keyboard.insertText("Tools");
  await page.keyboard.press("Escape");
  expect((await last(page)).type).toBe("text");

  // image through the right-click Import file; plugin custom shape (an image)
  const png = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 90;
      c.height = 60;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#e03131";
      ctx.fillRect(0, 0, 90, 60);
      return c.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  const imgAt = await toClient(page, 800, 450);
  await page.mouse.click(imgAt.x, imgAt.y, { button: "right" });
  const importItem = page
    .locator(".context-menu")
    .getByRole("button", { name: "Import file…" });
  await expect(importItem).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await importItem.click();
  await (
    await chooser
  ).setFiles({
    name: "red.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect
    .poll(
      async () => (await els(page)).filter((e) => e.type === "image").length,
    )
    .toBe(1);
  await page.getByRole("button", { name: "Badge" }).click();
  await expect
    .poll(
      async () => (await els(page)).filter((e) => e.type === "image").length,
    )
    .toBe(2);
  await page.keyboard.press("Escape");

  // 2. click with no drag, 2 px drags, ends off the canvas
  const baseline = await count(page);
  for (const tool of ["rectangle", "diamond", "ellipse", "arrow", "line"]) {
    await selectTool(page, tool);
    const c = await toClient(page, 900, 600);
    await page.mouse.click(c.x, c.y);
    // arrow and line start a multi-point path on a click; Escape drops it
    await page.keyboard.press("Escape");
    expect(await count(page), `${tool}: a click draws nothing`).toBe(baseline);
    await selectTool(page, tool);
    await drag(page, [900, 600], [902, 601], { steps: 1 });
    const now = await els(page);
    for (const e of now.slice(baseline)) {
      finite(e, `${tool} 2px drag`);
      expect(e.width, `${tool} 2px drag stays tiny`).toBeLessThan(6);
    }
    // drop whatever the tiny drag left so the next tool starts level
    if (now.length > baseline) {
      await page.keyboard.press("Delete");
    }
    expect(await count(page)).toBe(baseline);
  }
  await selectTool(page, "text");
  const tc = await toClient(page, 900, 620);
  await page.mouse.click(tc.x, tc.y);
  await page.keyboard.press("Escape");
  expect(await count(page), "empty text is dropped").toBe(baseline);

  // a drag that ends past the canvas edge still makes a finite shape
  await selectTool(page, "rectangle");
  const edgeFrom = await toClient(page, 900, 700);
  await page.mouse.move(edgeFrom.x, edgeFrom.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height - 1, {
    steps: 5,
  });
  await page.mouse.up();
  const edge = await last(page);
  finite(edge, "drag to the canvas edge");
  expect(edge.width).toBeGreaterThan(10);

  // a drag that starts left of the canvas (page chrome) draws nothing
  const chromeOk = await page.evaluate(
    ([x, y]) => {
      const e = document.elementFromPoint(x, y) as HTMLElement | null;
      return !!e && !e.closest("[draggable='true'], .vault-tree-item");
    },
    [box.x - 8, box.y + 300] as const,
  );
  if (chromeOk) {
    const n = await count(page);
    await selectTool(page, "rectangle");
    await page.mouse.move(box.x - 8, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 400, { steps: 5 });
    await page.mouse.up();
    expect(await count(page), "a drag started off the canvas").toBe(n);
  }
  await page.keyboard.press("Escape");

  // 3. undo and redo everything, then save and reopen
  const total = await els(page);
  const before = total.map(geom);
  const counts: number[] = [await count(page)];
  for (let i = 0; i < total.length * 3 + 10 && counts.at(-1)! > 0; i++) {
    await undo(page);
    counts.push(await count(page));
  }
  expect(counts.at(-1), "undo reaches the empty drawing").toBe(0);
  for (let i = 1; i < counts.length; i++) {
    await redo(page);
  }
  expect((await els(page)).map(geom)).toEqual(before);
  const file = await saved(page);
  expect(file.map((e) => e.id).sort()).toEqual(total.map((e) => e.id).sort());
  await reopen(page);
  expect((await els(page)).map(geom)).toEqual(before);
  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------------ 2 */

test("binding and frames: bind, move, delete, undo; frame children, arrow inside, move, resize", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);

  // arrow bound at both ends
  const A = await rectAt(page, 320, 200, 100, 70);
  const B = await rectAt(page, 620, 200, 100, 70);
  await selectTool(page, "arrow");
  await drag(page, [A.x + A.width - 4, A.y + 35], [B.x + 4, B.y + 35]);
  let arrow = await last(page);
  expect(arrow.type).toBe("arrow");
  expect(arrow.startBinding?.elementId, "arrow starts bound to A").toBe(A.id);
  expect(arrow.endBinding?.elementId, "arrow ends bound to B").toBe(B.id);
  expect((await byId(page, A.id)).boundElements.map((b: El) => b.id)).toContain(
    arrow.id,
  );

  // moving B drags the arrow's end along and keeps the binding
  await clickEdge(page, B);
  await drag(page, [B.x + 50, B.y], [B.x + 50, B.y + 120]);
  const B2 = await byId(page, B.id);
  near(B2.y, B.y + 120, 2, "B moved");
  arrow = await byId(page, arrow.id);
  expect(arrow.endBinding?.elementId).toBe(B.id);
  const tipX = arrow.x + arrow.points.at(-1)[0];
  const tipY = arrow.y + arrow.points.at(-1)[1];
  expect(tipX).toBeGreaterThan(B2.x - 25);
  expect(tipX).toBeLessThan(B2.x + B2.width + 25);
  expect(tipY).toBeGreaterThan(B2.y - 25);
  expect(tipY).toBeLessThan(B2.y + B2.height + 25);

  // deleting B unbinds the arrow end; undo binds it again
  await clickEdge(page, B2);
  await page.keyboard.press("Delete");
  expect((await els(page)).some((e) => e.id === B.id)).toBe(false);
  expect((await byId(page, arrow.id)).endBinding, "unbound").toBeNull();
  await undo(page);
  expect((await els(page)).some((e) => e.id === B.id)).toBe(true);
  expect(
    (await byId(page, arrow.id)).endBinding?.elementId,
    "undo binds the arrow to B again",
  ).toBe(B.id);

  // a frame with two children and a bound arrow inside
  const F = await draw(page, "frame", [300, 420], [700, 680]);
  const C = await rectAt(page, 330, 470, 90, 60);
  const D = await rectAt(page, 520, 470, 90, 60);
  expect(C.frameId, "C is a child of the frame").toBe(F.id);
  expect(D.frameId).toBe(F.id);
  const idsBefore = new Set((await els(page)).map((e) => e.id));
  await selectTool(page, "arrow");
  await drag(page, [C.x + C.width - 4, C.y + 30], [D.x + 4, D.y + 30]);
  const inner = await newest(page, idsBefore, "inner arrow");
  expect(inner.startBinding?.elementId).toBe(C.id);
  expect(inner.endBinding?.elementId).toBe(D.id);
  expect(inner.frameId, "the arrow between two children is in the frame").toBe(
    F.id,
  );

  // moving the frame moves children and arrow with it
  await clickEdge(page, F);
  await drag(page, [F.x + 200, F.y], [F.x + 240, F.y + 10]);
  const F2 = await byId(page, F.id);
  near(F2.x, F.x + 40, 2, "frame moved right");
  for (const id of [C.id, D.id, inner.id]) {
    const e = await byId(page, id);
    const was = id === C.id ? C : id === D.id ? D : inner;
    near(e.x, was.x + 40, 3, `child ${e.type} moved with the frame`);
    near(e.y, was.y + 10, 3, `child ${e.type} moved down with the frame`);
  }

  // resize the frame from its bottom-right corner
  await clickEdge(page, F2);
  await drag(
    page,
    [F2.x + F2.width + 4, F2.y + F2.height + 4],
    [F2.x + F2.width + 64, F2.y + F2.height + 44],
  );
  const F3 = await byId(page, F.id);
  expect(F3.width, "frame grew wider").toBeGreaterThan(F2.width + 40);
  expect(F3.height, "frame grew taller").toBeGreaterThan(F2.height + 20);
  expect(
    (await byId(page, C.id)).frameId,
    "children stay in a resized frame",
  ).toBe(F.id);

  // drag a child out (frameId clears), and a loose shape in (frameId set)
  const C2 = await byId(page, C.id);
  await clickEdge(page, C2);
  await drag(page, [C2.x + 45, C2.y], [850, 240]);
  expect(
    (await byId(page, C.id)).frameId,
    `dragged out of the frame ${JSON.stringify(
      [C2, await byId(page, C.id), await byId(page, F.id)].map(geom),
    )}`,
  ).toBeNull();
  const E = await rectAt(page, 900, 330, 60, 50);
  expect(E.frameId).toBeNull();
  await clickEdge(page, E);
  await drag(page, [930, 330], [F3.x + 150, F3.y + 150]);
  expect((await byId(page, E.id)).frameId, "dragged into the frame").toBe(F.id);
  await undo(page);
  expect(
    (await byId(page, E.id)).frameId,
    "undo takes it out again",
  ).toBeNull();
  await redo(page);
  expect((await byId(page, E.id)).frameId).toBe(F.id);

  // saved and reopened: bindings and frame membership survive
  const file = await saved(page);
  const file1 = (id: string) => file.find((e) => e.id === id)!;
  expect(file1(arrow.id).startBinding.elementId).toBe(A.id);
  expect(file1(inner.id).frameId).toBe(F.id);
  expect(file1(E.id).frameId).toBe(F.id);
  await reopen(page);
  expect((await byId(page, inner.id)).endBinding.elementId).toBe(D.id);
  expect((await byId(page, E.id)).frameId).toBe(F.id);
  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------------ 3 */

test("groups and editing: groups, nesting, Alt-drag, duplicate, paste, nudge, lock, z-order, align, distribute", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);

  // three shapes -> a group -> a nested group
  const R1 = await rectAt(page, 320, 180, 100, 70);
  const R2 = await draw(page, "ellipse", [500, 180], [600, 250]);
  const R3 = await draw(page, "diamond", [680, 180], [780, 250]);
  // Rubber-band (marquee) selection works in WebKit, but only when each pointer move is its
  // own event-loop turn: Playwright's `mouse.move(..., { steps })` fires the moves back to
  // back, the editor handles pointer moves once per frame and sees only the first, so the box
  // stays empty. A harness limit, not an app bug (checked 2026-10-28: per-move awaits select
  // 20 of 20 times, burst moves selected nothing in 14 of 16 runs). The "marquee" step below uses spaced moves.
  // The other steps multi-select by Shift-clicking edges, which is faster and exact.
  const selectMany = async (list: El[]) => {
    await page.keyboard.press("Escape");
    await clickEdge(page, list[0]);
    await page.keyboard.down("Shift");
    for (const e of list.slice(1)) {
      const c = await toClient(page, e.x + e.width / 2, e.y);
      await page.mouse.click(c.x, c.y);
    }
    await page.keyboard.up("Shift");
  };
  await selectMany([R1, R2, R3]);
  expect((await snap(page)).sel.length, "Shift-click selects the three").toBe(
    3,
  );
  // real rubber-band box around the three shapes, with spaced pointer moves
  await page.keyboard.press("Escape");
  {
    const a = await toClient(page, 280, 130);
    const b = await toClient(page, 830, 300);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(
        a.x + ((b.x - a.x) * i) / 6,
        a.y + ((b.y - a.y) * i) / 6,
      );
      await page.waitForTimeout(0);
    }
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.waitForTimeout(100);
  }
  expect((await snap(page)).sel.length, "marquee selects the three").toBe(3);
  await page.keyboard.press("Meta+KeyG");
  let g = await els(page);
  const gid = g[0].groupIds[0];
  expect(gid, "grouped").toBeTruthy();
  expect(g.every((e) => e.groupIds.length === 1 && e.groupIds[0] === gid)).toBe(
    true,
  );
  // clicking one member selects the group; dragging moves all of it
  await clickEdge(page, R1);
  expect((await snap(page)).sel.length, "click selects the whole group").toBe(
    3,
  );
  await drag(page, [R1.x + 50, R1.y], [R1.x + 50, R1.y + 30]);
  for (const e of await els(page)) {
    const was = [R1, R2, R3].find((o) => o.id === e.id)!;
    near(e.y, was.y + 30, 2, "group member moved");
  }
  const R4 = await rectAt(page, 320, 330, 100, 70);
  await selectMany([await byId(page, R1.id), await byId(page, R4.id)]);
  await page.keyboard.press("Meta+KeyG");
  g = await els(page);
  expect(
    g.filter((e) => e.id !== R4.id).every((e) => e.groupIds.length === 2),
    "nested group: members carry two group ids",
  ).toBe(true);
  expect(g.find((e) => e.id === R4.id)!.groupIds.length).toBe(1);
  await page.keyboard.press("Meta+Shift+KeyG");
  g = await els(page);
  expect(g.find((e) => e.id === R4.id)!.groupIds.length, "ungroup").toBe(0);
  expect(g.find((e) => e.id === R1.id)!.groupIds.length).toBe(1);
  await undo(page);
  expect(
    (await byId(page, R4.id)).groupIds.length,
    "undo ungroup restores the nesting",
  ).toBe(1);
  await redo(page);
  // double-click enters the group
  const dc = await toClient(page, R1.x + 50, R1.y + 30);
  await page.mouse.dblclick(dc.x, dc.y);
  expect(
    (await snap(page)).editingGroupId,
    "double-click edits inside the group",
  ).toBeTruthy();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // ungroup everything (twice, outermost first) so align sees single shapes
  await page.keyboard.press("Meta+KeyA");
  await page.keyboard.press("Meta+Shift+KeyG");
  await page.keyboard.press("Meta+KeyA");
  await page.keyboard.press("Meta+Shift+KeyG");
  expect(
    (await els(page)).every((e) => e.groupIds.length === 0),
    "ungrouped everything",
  ).toBe(true);
  await page.keyboard.press("Escape");

  // fresh row for the editing operations
  const S1 = await rectAt(page, 320, 480, 100, 70);
  const S2 = await rectAt(page, 500, 480, 100, 70);
  const S3 = await rectAt(page, 680, 480, 100, 70);
  const total0 = await count(page);

  // Alt-drag duplicates, the original stays
  await clickEdge(page, S1);
  let seen = new Set((await els(page)).map((e) => e.id));
  await drag(page, [S1.x + 50, S1.y], [S1.x + 50, S1.y + 150], { alt: true });
  expect(await count(page), "Alt-drag copies").toBe(total0 + 1);
  near((await byId(page, S1.id)).y, S1.y, 1, "original stays");
  const copy = await newest(page, seen, "Alt-drag copy");
  near(copy.y, S1.y + 150, 2, "copy dropped where released");
  // Cmd+D duplicates the selection
  seen = new Set((await els(page)).map((e) => e.id));
  await page.keyboard.press("Meta+KeyD");
  expect(await count(page), "Cmd+D").toBe(total0 + 2);
  const dup = await newest(page, seen, "Cmd+D copy");
  expect(dup.id).not.toBe(copy.id);
  near(dup.x, copy.x + 10, 3, "duplicate offset");
  // copy and paste
  await page.keyboard.press("Meta+KeyC");
  await page.keyboard.press("Meta+KeyV");
  await expect.poll(() => count(page)).toBe(total0 + 3);
  // undo / redo walks each of those
  await undo(page);
  expect(await count(page)).toBe(total0 + 2);
  await undo(page);
  await undo(page);
  expect(await count(page), "undo duplicates").toBe(total0);
  await redo(page);
  await redo(page);
  await redo(page);
  expect(await count(page)).toBe(total0 + 3);

  // nudge with the arrow keys: 1 px, Shift 5 px
  await clickEdge(page, S2);
  const nx = (await byId(page, S2.id)).x;
  await page.keyboard.press("ArrowRight");
  near((await byId(page, S2.id)).x, nx + 1, 0.6, "arrow key nudge");
  await page.keyboard.press("Shift+ArrowRight");
  near((await byId(page, S2.id)).x, nx + 6, 0.6, "Shift+arrow nudge");
  await page.keyboard.press("ArrowUp");
  near((await byId(page, S2.id)).y, S2.y - 1, 0.6, "arrow up");

  // lock through the context menu: it cannot be dragged; unlock all
  const lc = await toClient(page, S2.x + 50, S2.y - 1);
  await page.mouse.click(lc.x, lc.y, { button: "right" });
  await page
    .locator(".context-menu")
    .getByText(/^Lock$/)
    .first()
    .click();
  expect((await byId(page, S2.id)).locked, "locked").toBe(true);
  const lockedX = (await byId(page, S2.id)).x;
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await drag(page, [S2.x + 50, S2.y - 1], [S2.x + 50, S2.y + 99]);
  near((await byId(page, S2.id)).x, lockedX, 0.1, "a locked shape stays");
  near((await byId(page, S2.id)).y, S2.y - 1, 0.1, "a locked shape stays (y)");
  const empty = await toClient(page, 880, 640);
  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await page
    .locator(".context-menu")
    .getByText(/^Unlock all$/)
    .first()
    .click();
  expect((await byId(page, S2.id)).locked, "unlocked").toBe(false);

  // z-order through its shortcuts: the array order is the stacking order
  const order = async () => (await els(page)).map((e) => e.id);
  const zMenu = async (label: string) => {
    await clickEdge(page, await byId(page, S3.id));
    await page
      .locator("section.selected-shape-actions button[title='Actions']")
      .click();
    await page
      .getByTitle(new RegExp(`^${label}`))
      .first()
      .click();
    await page.keyboard.press("Escape");
  };
  await zMenu("Bring to front");
  expect((await order()).at(-1), "bring to front").toBe(S3.id);
  await zMenu("Send to back");
  expect((await order())[0], "send to back").toBe(S3.id);
  // the shortcuts: on macOS Cmd+Alt+[ / ] (Cmd+Shift+[ / ] is the Windows and Linux binding,
  // so it does nothing in WebKit on a Mac: not an app bug; the registry and Excalidraw agree)
  await clickEdge(page, await byId(page, S3.id));
  await page.keyboard.press("Meta+Alt+BracketRight");
  expect((await order()).at(-1), "Cmd+Alt+] brings to front").toBe(S3.id);
  await page.keyboard.press("Meta+Alt+BracketLeft");
  expect((await order())[0], "Cmd+Alt+[ sends to back").toBe(S3.id);
  await page.keyboard.press("Escape");
  await zMenu("Bring forward");
  const fwd = (await order()).indexOf(S3.id);
  expect(fwd, "bring forward moves it up one step or more").toBeGreaterThan(0);
  expect(fwd).toBeLessThan((await count(page)) - 1);
  await zMenu("Send backward");
  expect(
    (await order()).indexOf(S3.id),
    "send backward moves it down again",
  ).toBeLessThan(fwd);

  // align and distribute everything
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+KeyA");
  const xs0 = (await els(page)).map((e) => e.x);
  const actions = page.locator(
    "section.selected-shape-actions button[title='Actions']",
  );
  await actions.click();
  await page.getByRole("button", { name: "Align left" }).click();
  const minX = Math.min(...xs0);
  for (const e of await els(page)) {
    near(e.x, minX, 1.5, "align left");
  }
  if (
    !(await page
      .getByRole("button", { name: "Distribute vertically" })
      .isVisible())
  ) {
    await actions.click();
  }
  await page.getByRole("button", { name: "Distribute vertically" }).click();
  const sorted = (await els(page)).slice().sort((a, b) => a.y - b.y);
  const gaps = sorted
    .slice(1)
    .map((e, i) => e.y - (sorted[i].y + sorted[i].height));
  expect(
    Math.max(...gaps) - Math.min(...gaps),
    `distributed gaps are equal (${gaps.map(Math.round)})`,
  ).toBeLessThan(4);
  await undo(page);
  await undo(page);
  expect(
    (await els(page)).map((e) => e.x).sort((a, b) => a - b),
    "undo restores the positions",
  ).toEqual(xs0.slice().sort((a, b) => a - b));

  // everything survives save and reopen
  const before = (await els(page)).map(geom);
  await saved(page);
  await reopen(page);
  expect((await els(page)).map(geom)).toEqual(before);
  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------------ 4 */

test("text: empty, huge, unicode, right-to-left, emoji, multi-line, font, in a container; saved and reopened", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);

  const cases: { name: string; lines: string[]; y: number }[] = [
    { name: "plain", lines: ["Hello text"], y: 180 },
    { name: "unicode", lines: ["héllo wörld ñ ß 日本語 ελληνικά"], y: 230 },
    { name: "rtl", lines: ["שלום עולם مرحبا بالعالم"], y: 280 },
    { name: "emoji", lines: ["😀👍🏽🇮🇳 ok 🧑‍🚀"], y: 330 },
    { name: "multi", lines: ["line one", "line two", "", "line four"], y: 380 },
    { name: "punct", lines: ['<b>&amp;</b> "q" \\ / tab'], y: 500 },
  ];
  const made: { name: string; id: string; text: string }[] = [];
  const textTool = async (x: number, y: number, lines: string[]) => {
    await selectTool(page, "text");
    const c = await toClient(page, x, y);
    await page.mouse.click(c.x, c.y);
    for (const [i, l] of lines.entries()) {
      if (i > 0) {
        await page.keyboard.press("Enter");
      }
      if (l) {
        await page.keyboard.insertText(l);
      }
    }
    await page.keyboard.press("Escape");
  };
  for (const c of cases) {
    const n = await count(page);
    await textTool(320, c.y, c.lines);
    expect(await count(page), `${c.name}: one text element`).toBe(n + 1);
    const e = await last(page);
    expect(e.type).toBe("text");
    finite(e, c.name);
    expect(e.originalText, c.name).toBe(c.lines.join("\n"));
    expect(e.width, `${c.name} has width`).toBeGreaterThan(5);
    expect(await sceneInk(page, e), `${c.name} is painted`).toBeGreaterThan(2);
    made.push({ name: c.name, id: e.id, text: c.lines.join("\n") });
  }
  expect(
    (await els(page)).find((e) => e.id === made[4].id)!.height,
    "multi-line is taller than one line",
  ).toBeGreaterThan(
    (await els(page)).find((e) => e.id === made[0].id)!.height * 2.5,
  );

  // empty text leaves nothing; so does whitespace only
  const n0 = await count(page);
  await textTool(320, 600, [""]);
  expect(await count(page), "empty text is dropped").toBe(n0);
  await textTool(320, 600, ["   "]);
  expect(await count(page), "whitespace-only text is dropped").toBe(n0);

  // font change through the panel: select the plain text, pick Code
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const plain = await byId(page, made[0].id);
  const pc = await toClient(
    page,
    plain.x + plain.width / 2,
    plain.y + plain.height / 2,
  );
  await page.keyboard.press("v");
  await page.mouse.click(pc.x, pc.y);
  await page.waitForTimeout(300);
  await expect
    .poll(async () => (await snap(page)).sel, "the plain text is selected")
    .toEqual([plain.id]);
  const fontBefore = (await byId(page, made[0].id)).fontFamily;
  const widthBefore = (await byId(page, made[0].id)).width;
  await page.getByTestId("font-family-show-fonts").click();
  const comic = page.locator(".dropdown-menu.fonts").getByText("Comic Shanns");
  await comic.hover();
  await comic.click();
  await expect
    .poll(async () => (await byId(page, made[0].id)).fontFamily, "font changed")
    .not.toBe(fontBefore);
  const fontAfter = await byId(page, made[0].id);
  expect(fontAfter.width, "the text box re-measures").not.toBe(widthBefore);
  await undo(page);
  expect((await byId(page, made[0].id)).fontFamily, "undo font").toBe(
    fontBefore,
  );

  // text in a container: double-click a rectangle, type
  await page.keyboard.press("Escape");
  const box = await rectAt(page, 700, 200, 120, 60);
  await page.keyboard.press("v");
  const dc = await toClient(page, box.x + 60, box.y + 30);
  await page.mouse.dblclick(dc.x, dc.y);
  await page.keyboard.insertText(
    "inside the box with a long enough line to wrap around",
  );
  await page.keyboard.press("Escape");
  const bound = (await els(page)).find((e) => e.containerId === box.id)!;
  expect(bound, "text bound to the container").toBeTruthy();
  const container = await byId(page, box.id);
  expect(container.boundElements.map((b: El) => b.id)).toContain(bound.id);
  expect(container.height, "the container grows to fit").toBeGreaterThanOrEqual(
    60,
  );
  // moving the container moves its text
  await clickEdge(page, container);
  await drag(
    page,
    [container.x + 60, container.y],
    [container.x + 160, container.y + 50],
  );
  const moved = (await els(page)).find((e) => e.id === bound.id)!;
  near(moved.x, bound.x + 100, 3, "container text follows (x)");
  near(moved.y, bound.y + 50, 3, "container text follows (y)");

  // a very long single line (last: typing it scrolls the view)
  const long = "long ".repeat(400);
  await textTool(320, 650, [long.trim()]);
  const longEl = await last(page);
  expect(longEl.width, "very long text fills the width").toBeGreaterThan(300);
  expect(longEl.originalText.length).toBe(long.trim().length);
  finite(longEl, "long text");

  // saved and reopened: every string is intact
  const file = await saved(page);
  for (const m of made) {
    expect(file.find((e) => e.id === m.id)!.originalText, m.name).toBe(m.text);
  }
  await reopen(page);
  for (const m of made) {
    expect((await byId(page, m.id)).originalText, `${m.name} reopened`).toBe(
      m.text,
    );
  }
  expect(
    (await els(page)).find((e) => e.id === bound.id)!.containerId,
    "container binding reopened",
  ).toBe(box.id);
  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------------ 5 */

test("view: zoom 10% and 3000%, pan, theme, huge and tiny shapes, SVG and PNG export, save and reopen", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);

  const zoomTo = async (target: number, key: "Minus" | "Equal") => {
    for (let i = 0; i < 700; i++) {
      await page.keyboard.press(`Meta+${key}`);
      if (i % 10 === 9) {
        const z = (await snap(page)).zoom;
        if (key === "Minus" ? z <= target : z >= target) {
          break;
        }
      }
    }
    return (await snap(page)).zoom;
  };

  // normal-size reference shapes
  const R = await rectAt(page, 320, 200, 100, 70);
  const T = await draw(page, "ellipse", [500, 200], [600, 270]);

  // zoom out to the 10% floor, draw a huge shape there
  const zMin = await zoomTo(0.1, "Minus");
  near(zMin, 0.1, 0.01, "zoom floor is 10%");
  await page.keyboard.press("Meta+Minus");
  expect(
    (await snap(page)).zoom,
    "zoom cannot go below 10%",
  ).toBeGreaterThanOrEqual(0.0999);
  await selectTool(page, "rectangle");
  const cb = await canvasBox(page);
  await page.mouse.move(cb.x + 300, cb.y + 300);
  await page.mouse.down();
  await page.mouse.move(cb.x + 700, cb.y + 500, { steps: 5 });
  await page.mouse.up();
  const huge = await last(page);
  finite(huge, "huge");
  expect(huge.width, "a drag at 10% makes a big shape").toBeGreaterThan(2000);
  expect(
    await sceneInk(page, huge, 0),
    "huge shape painted at 10%",
  ).toBeGreaterThan(5);

  // back to 100%, a tiny shape, then the 3000% ceiling
  await page.keyboard.press("Meta+Digit0");
  near((await snap(page)).zoom, 1, 0.01, "Cmd+0 resets zoom");
  const tinyEl = await draw(page, "rectangle", [700, 200], [703, 202]);
  expect(tinyEl.width, "tiny shape at 100%").toBeLessThan(5);
  const zMax = await zoomTo(30, "Equal");
  expect(zMax, "zoom ceiling is 3000%").toBeGreaterThan(29.9);
  await page.keyboard.press("Meta+Equal");
  expect((await snap(page)).zoom, "zoom cannot pass 3000%").toBeLessThanOrEqual(
    30.0001,
  );
  await selectTool(page, "rectangle");
  await page.mouse.move(cb.x + 400, cb.y + 400);
  await page.mouse.down();
  await page.mouse.move(cb.x + 460, cb.y + 450, { steps: 4 });
  await page.mouse.up();
  const micro = await last(page);
  finite(micro, "micro");
  expect(micro.width, "3000%: 60 px is two scene units").toBeLessThan(3);
  expect(micro.width).toBeGreaterThan(1.5);
  await page.keyboard.press("Meta+Digit0");

  // pan: wheel and space-drag move the view, not the shapes
  const view0 = await snap(page);
  const mid = await toClient(page, 760, 400);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.wheel(0, 120);
  await expect
    .poll(async () => (await snap(page)).scrollY)
    .not.toBe(view0.scrollY);
  await page.mouse.wheel(60, 0);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(mid.x + 90, mid.y + 40, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  const view1 = await snap(page);
  expect(view1.scrollX).not.toBe(view0.scrollX);
  near((await byId(page, R.id)).x, R.x, 0.01, "panning leaves shapes alone");

  // theme: dark and back; shapes stay painted
  await page.keyboard.press("Meta+Digit0");
  const themeBefore = (await snap(page)).theme;
  await page.keyboard.press("Shift+Alt+KeyD");
  await expect.poll(async () => (await snap(page)).theme).not.toBe(themeBefore);
  expect(
    await sceneInk(page, await byId(page, R.id)),
    "painted in the other theme",
  ).toBeGreaterThan(3);
  await page.keyboard.press("Shift+Alt+KeyD");
  await expect.poll(async () => (await snap(page)).theme).toBe(themeBefore);

  // SVG and PNG export of everything, huge shape included
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+KeyA");
  await openExportDialogFromMenu(page);
  await exportDialogButton(page, "SVG").click();
  await expect
    .poll(async () => (await exportedNames(page)).length)
    .toBeGreaterThan(0);
  const svg: string = await page.evaluate(() =>
    new TextDecoder().decode((window as any).__vaultRepo.exported.at(-1).bytes),
  );
  expect(svg.includes("<svg"), "an SVG came out").toBe(true);
  expect(
    (svg.match(/<path/g) ?? []).length,
    "every shape is in the SVG",
  ).toBeGreaterThanOrEqual(4);
  await exportDialogButton(page, "PNG").click();
  await expect
    .poll(async () => (await exportedNames(page)).length)
    .toBeGreaterThan(1);
  const pngHead: number[] = await page.evaluate(() =>
    Array.from(
      new Uint8Array((window as any).__vaultRepo.exported.at(-1).bytes).slice(
        0,
        4,
      ),
    ),
  );
  expect(pngHead, "PNG signature").toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(
    (await exportedNames(page)).slice(-2).map((n) => n.split(".").pop()),
  ).toEqual(["svg", "png"]);
  await page.locator(".Modal__background").click({ position: { x: 4, y: 4 } });
  await expect(page.locator(".Modal")).toHaveCount(0);

  // save and reopen: every shape, with its size, survived the extremes
  const before = (await els(page)).map(geom);
  const file = await saved(page);
  expect(file.length).toBe(before.length);
  await reopen(page);
  expect((await els(page)).map(geom)).toEqual(before);
  expect((await byId(page, T.id)).type).toBe("ellipse");
  expect(errors).toEqual([]);
});
