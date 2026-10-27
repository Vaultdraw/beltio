import { expect, test, type Page } from "@playwright/test";

import { AFTER_AUTOSAVE_MS } from "./constants";
import {
  exportDialogButton,
  openDrawing,
  openExportDialogFromMenu,
  openVault,
  readScene,
  trackErrors,
} from "./helpers";
import { live, seedAndOpen, toClient } from "./pageHelpers";

/**
 * Owner bug (2026-10-27): dragging an arrow or line showed it at scene (0,0)
 * while the button was down and moved it to the right place on release. Every
 * shape tool is drawn here through the visible toolbar and style panel, in
 * many style variations, and for each drawing we check:
 *   1. while dragging: the element is where the drag started and nothing is
 *      painted outside the drawn boxes (the (0,0) ghost);
 *   2. after the drop: x, y, width, height match the drag and the style
 *      properties match what the panel was set to;
 *   3. it is painted (pixels inside its box);
 *   4. after autosave and a reload the same holds;
 *   5. (one test) the SVG export keeps dashed and dotted strokes.
 * Tests run in parallel; each draws many shapes into one fresh drawing.
 */
test.describe.configure({ mode: "parallel" });

const FILE = "Shapes.excalidraw";
const SIZE = { w: 120, h: 70 };
/** Grid of drag cells, in scene px; clear of the toolbar and the style panel. */
const cellOrigin = (i: number) => ({
  x: 170 + (i % 4) * 170,
  y: 160 + Math.floor(i / 4) * 115,
});

type Box = { x1: number; y1: number; x2: number; y2: number };
type Style = {
  strokeStyle?: "solid" | "dashed" | "dotted";
  width?: "thin" | "medium" | "bold";
  rough?: "Architect" | "Artist" | "Cartoonist";
  fill?: "none" | "Hachure" | "Cross-hatch" | "Solid";
  edges?: "Sharp" | "Round";
  arrowType?: "sharp" | "round" | "elbow";
  heads?: [string, string];
};
const WIDTH_VALUE = { thin: 1, medium: 2, bold: 4 };
const FREEDRAW_WIDTH = { thin: 0.5, medium: 1, bold: 2 };
const ROUGH_VALUE = { Architect: 0, Artist: 1, Cartoonist: 2 };

const toolButton = (page: Page, tool: string) =>
  page.locator(`.vault-editor [data-testid='toolbar-${tool}']`);

/**
 * Picks a tool by its toolbar button. The pen button opens the pens palette
 * instead of arming the tool, so freedraw uses its key (P).
 */
const selectTool = async (page: Page, tool: string) => {
  if (tool === "freedraw") {
    await page.keyboard.press("p");
  } else {
    await toolButton(page, tool).click();
  }
};

/**
 * One option of the open style popover by its title. "Solid" is both a fill
 * and a stroke style: the fill group comes first.
 */
const pickOption = async (
  page: Page,
  title: string,
  optional = false,
  which: "first" | "last" = "first",
) => {
  const o = page
    .locator("div.selected-shape-actions")
    .getByTitle(new RegExp(`^${title}( \\(|$)`));
  if ((await o.count()) > 0) {
    await o[which]().click();
    return true;
  }
  if (!optional) {
    const titles = await page
      .locator("div.selected-shape-actions [title]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("title")));
    throw new Error(`no "${title}" option; panel offers ${titles.join(", ")}`);
  }
  return false;
};

const setBackground = async (page: Page, swatch: "transparent" | "red") => {
  await page
    .locator(
      "section.selected-shape-actions button[title='Show background color picker']",
    )
    .click();
  await page.getByTestId(`color-${swatch}`).first().click();
  await page
    .locator(
      "section.selected-shape-actions button[title='Show background color picker']",
    )
    .click();
};

/** Applies `s` through the visible style panel for the active tool. */
const applyStyle = async (page: Page, tool: string, s: Style) => {
  const hasBackground =
    (await page
      .locator(
        "section.selected-shape-actions button[title='Show background color picker']",
      )
      .count()) > 0;
  if (s.fill && hasBackground) {
    await setBackground(page, s.fill === "none" ? "transparent" : "red");
  }
  if (s.arrowType || s.heads) {
    await page
      .locator("section.selected-shape-actions button[title='Arrow type']")
      .click();
    if (s.arrowType) {
      await page
        .getByTestId(`${s.arrowType}-arrow`)
        .first()
        .click({ force: true });
    }
    if (s.heads) {
      const pickers = page.locator(".properties-content button:not([title])");
      for (const [i, name] of s.heads.entries()) {
        await pickers.nth(i).click();
        await page
          .getByTitle(new RegExp(`^${name.replace(/[()]/g, "\\$&")} —`))
          .first()
          .click();
      }
    }
    await page
      .locator("section.selected-shape-actions button[title='Arrow type']")
      .click();
  }
  if (
    s.strokeStyle ||
    s.width ||
    s.rough ||
    s.edges ||
    (s.fill && s.fill !== "none")
  ) {
    await page
      .locator("section.selected-shape-actions button[title='Stroke']")
      .last()
      .click();
    if (s.fill && s.fill !== "none") {
      await pickOption(page, s.fill);
    }
    if (s.width) {
      await page
        .getByTestId(`strokeWidth-${s.width}`)
        .first()
        .click({ force: true });
    }
    if (s.strokeStyle) {
      await pickOption(
        page,
        s.strokeStyle[0].toUpperCase() + s.strokeStyle.slice(1),
        false,
        "last",
      );
    }
    if (s.rough) {
      await pickOption(page, s.rough);
    }
    if (s.edges) {
      await pickOption(page, s.edges, tool === "ellipse");
    }
    await page
      .locator("section.selected-shape-actions button[title='Stroke']")
      .last()
      .click();
  }
  await selectTool(page, tool);
};

/** Pixels of the editor's scene canvases that differ from the page colour. */
const inkCounts = (page: Page, boxes: Box[], inside: Box) =>
  page.evaluate(
    ([bx, ins]) => {
      const canvases = [
        ...document.querySelectorAll<HTMLCanvasElement>(".vault-editor canvas"),
      ].filter((c) => !c.classList.contains("interactive") && c.width > 0);
      let outside = 0;
      let within = 0;
      for (const c of canvases) {
        const r = c.getBoundingClientRect();
        const s = c.width / r.width;
        const d = c
          .getContext("2d")!
          .getImageData(0, 0, c.width, c.height).data;
        const at = (x: number, y: number) => (y * c.width + x) * 4;
        const bgI = at(c.width - 3, c.height - 3);
        const bg = [d[bgI], d[bgI + 1], d[bgI + 2], d[bgI + 3]];
        for (let y = 0; y < c.height; y += 3) {
          for (let x = 0; x < c.width; x += 3) {
            const i = at(x, y);
            const diff =
              Math.abs(d[i] - bg[0]) +
              Math.abs(d[i + 1] - bg[1]) +
              Math.abs(d[i + 2] - bg[2]) +
              Math.abs(d[i + 3] - bg[3]);
            if (diff < 60) {
              continue;
            }
            const cx = x / s + r.left;
            const cy = y / s + r.top;
            if (cx >= ins.x1 && cx <= ins.x2 && cy >= ins.y1 && cy <= ins.y2) {
              within++;
            }
            if (
              !(bx as Box[]).some(
                (b) => cx >= b.x1 && cx <= b.x2 && cy >= b.y1 && cy <= b.y2,
              )
            ) {
              outside++;
            }
          }
        }
      }
      return { outside, within };
    },
    [boxes, inside] as const,
  );

const sceneBox = async (
  page: Page,
  x: number,
  y: number,
  w: number,
  h: number,
  pad: number,
): Promise<Box> => {
  const a = await toClient(page, x, y);
  const b = await toClient(page, x + w, y + h);
  const z = (await live(page)).zoom;
  return {
    x1: Math.min(a.x, b.x) - pad * z,
    y1: Math.min(a.y, b.y) - pad * z,
    x2: Math.max(a.x, b.x) + pad * z,
    y2: Math.max(a.y, b.y) + pad * z,
  };
};

type Drawn = { id: string; tool: string; cell: number; style: Style; box: Box };

type Ctx = {
  page: Page;
  drawn: Drawn[];
  sceneBoxes: [number, number, number, number][];
  origin?: (i: number) => { x: number; y: number };
};

const nearly = (a: number, b: number, tol = 1.5) =>
  expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);

const lastElement = async (page: Page) => (await live(page)).elements.at(-1)!;

/**
 * Draws one shape with a real mouse drag in cell `cell` and checks it while
 * the button is down and after the drop.
 */
const drawShape = async (
  ctx: Ctx,
  tool: string,
  cell: number,
  style: Style,
  size = SIZE,
) => {
  const { page } = ctx;
  const type =
    tool === "rectangle" ||
    tool === "diamond" ||
    tool === "ellipse" ||
    tool === "arrow" ||
    tool === "line" ||
    tool === "freedraw"
      ? tool
      : tool;
  await selectTool(page, tool);
  await expect(page.locator("section.selected-shape-actions")).toBeVisible();
  await applyStyle(page, tool, style);
  const o = (ctx.origin ?? cellOrigin)(cell);
  const before = (await live(page)).elements.length;
  const from = await toClient(page, o.x, o.y);
  const z = (await live(page)).zoom;
  const box = await sceneBox(page, o.x, o.y, size.w, size.h, 30);
  ctx.sceneBoxes.push([o.x, o.y, size.w, size.h]);
  const boxes = [...ctx.drawn.map((d) => d.box), box];

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (tool === "freedraw") {
    // a zig-zag that stays inside the box and ends at its right edge
    const pts = [0.2, 0.4, 0.6, 0.8, 1];
    for (const [i, f] of pts.entries()) {
      await page.mouse.move(
        from.x + size.w * f * z,
        from.y + (i % 2 ? size.h : size.h * 0.4) * z,
        { steps: 3 },
      );
    }
  } else {
    await page.mouse.move(
      from.x + (size.w / 2) * z,
      from.y + (size.h / 2) * z,
      { steps: 4 },
    );
  }
  await page.waitForTimeout(80);
  // 1. while dragging: where it started, and nothing painted outside the boxes
  const midEl = await lastElement(page);
  expect((await live(page)).elements.length, `${tool} created`).toBe(
    before + 1,
  );
  nearly(midEl.x, o.x);
  nearly(midEl.y, o.y);
  const mid = await inkCounts(page, boxes, box);
  expect(mid.outside, `${tool} #${cell} ghost ink while dragging`).toBe(0);
  if (tool !== "freedraw") {
    await page.mouse.move(from.x + size.w * z, from.y + size.h * z, {
      steps: 4,
    });
  }
  await page.mouse.up();
  await page.waitForTimeout(120);

  // 2. after the drop
  const el = (await live(page)).elements.at(-1)!;
  expect(el.type).toBe(type);
  nearly(el.x, o.x);
  nearly(el.y, o.y);
  nearly(el.width, size.w, tool === "freedraw" ? 3 : 1.5);
  if (tool !== "freedraw") {
    nearly(el.height, size.h);
  }
  // 3. painted, and nothing outside the boxes
  const end = await inkCounts(page, boxes, box);
  expect(end.within, `${tool} #${cell} is painted`).toBeGreaterThan(8);
  expect(end.outside, `${tool} #${cell} ink outside after drop`).toBe(0);

  ctx.drawn.push({ id: el.id, tool, cell, style, box });
  void size;
};

type SavedEl = Record<string, any>;
const checkProps = (el: SavedEl, d: Drawn) => {
  if (el.strokeStyle === undefined) {
    return; // live elements carry only geometry; the saved file is checked above
  }
  const s = d.style;
  if (s.strokeStyle) {
    expect(el.strokeStyle, `${d.tool}#${d.cell} strokeStyle`).toBe(
      s.strokeStyle,
    );
  }
  if (s.width) {
    expect(el.strokeWidth, `${d.tool}#${d.cell} width`).toBe(
      (d.tool === "freedraw" ? FREEDRAW_WIDTH : WIDTH_VALUE)[s.width],
    );
  }
  if (s.rough) {
    expect(el.roughness, `${d.tool}#${d.cell} roughness`).toBe(
      ROUGH_VALUE[s.rough],
    );
  }
  if (s.fill && d.tool !== "line") {
    if (s.fill === "none") {
      expect(el.backgroundColor).toBe("transparent");
    } else {
      expect(el.backgroundColor).not.toBe("transparent");
      expect(el.fillStyle).toBe(
        { Hachure: "hachure", "Cross-hatch": "cross-hatch", Solid: "solid" }[
          s.fill
        ],
      );
    }
  }
  if (s.edges && (d.tool === "rectangle" || d.tool === "diamond")) {
    expect(el.roundness === null, `${d.tool}#${d.cell} edges`).toBe(
      s.edges === "Sharp",
    );
  }
  if (s.heads) {
    const name = (h: string) =>
      ((
        {
          None: null,
          Arrow: "arrow",
          Triangle: "triangle",
          "Triangle (outline)": "triangle_outline",
        } as any
      )[h]);
    expect(el.startArrowhead, "start arrowhead").toBe(name(s.heads[0]));
    expect(el.endArrowhead, "end arrowhead").toBe(name(s.heads[1]));
  }
  if (s.arrowType) {
    expect(el.elbowed === true, "elbowed").toBe(s.arrowType === "elbow");
    if (s.arrowType !== "elbow") {
      expect(el.roundness === null).toBe(s.arrowType === "sharp");
    }
  }
};

/** Saved file and live scene agree with the drawings; then painted again after a reload. */
const verifyEverything = async (ctx: Ctx) => {
  const { page, drawn } = ctx;
  await page.waitForTimeout(AFTER_AUTOSAVE_MS + 300);
  const saved = (await readScene(page, FILE)).elements.filter(
    (e: any) => !e.isDeleted,
  );
  const check = async (source: Map<string, SavedEl>, where: string) => {
    for (const d of drawn) {
      const el = source.get(d.id);
      expect(el, `${where}: ${d.tool}#${d.cell} exists`).toBeTruthy();
      const o = cellOrigin(d.cell);
      nearly(el!.x, o.x);
      nearly(el!.y, o.y);
      checkProps(el!, d);
    }
  };
  await check(new Map(saved.map((e: any) => [e.id, e])), "saved");

  // the in-memory vault does not survive a page reload: reopen by leaving the
  // drawing and coming back, which re-reads the saved file
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await openDrawing(page, "Shapes");
  await page.waitForTimeout(400);
  const lv = await live(page);
  await check(
    new Map(lv.elements.map((e) => [e.id, e as SavedEl])),
    "reopened",
  );
  // painted after reopening: ink inside every box, none outside the union
  const boxes: Box[] = [];
  for (const d of drawn) {
    const o = cellOrigin(d.cell);
    boxes.push(await sceneBox(page, o.x, o.y, SIZE.w, SIZE.h, 30));
  }
  for (const [i, d] of drawn.entries()) {
    const r = await inkCounts(page, boxes, boxes[i]);
    expect(r.within, `reopened: ${d.tool}#${d.cell} painted`).toBeGreaterThan(
      8,
    );
    expect(r.outside, `reopened: ${d.tool}#${d.cell} ink outside`).toBe(0);
  }
};

const startDrawing = async (page: Page): Promise<Ctx> => {
  await openVault(page);
  await seedAndOpen(page, FILE);
  return { page, drawn: [], sceneBoxes: [] };
};

const STYLES = ["solid", "dashed", "dotted"] as const;
const WIDTHS = ["thin", "medium", "bold"] as const;

/** 9 stroke style x width cells, then 6 roughness / fill / edge cells. */
const shapeVariants = (tool: string): Style[] => {
  const v: Style[] = [];
  for (const strokeStyle of STYLES) {
    for (const width of WIDTHS) {
      v.push({ strokeStyle, width });
    }
  }
  const sharp = tool !== "ellipse";
  v.push(
    {
      strokeStyle: "solid",
      width: "medium",
      rough: "Architect",
      fill: "Hachure",
      ...(sharp ? { edges: "Sharp" as const } : {}),
    },
    {
      rough: "Artist",
      fill: "Cross-hatch",
      ...(sharp ? { edges: "Round" as const } : {}),
    },
    {
      rough: "Cartoonist",
      fill: "Solid",
      ...(sharp ? { edges: "Sharp" as const } : {}),
    },
    {
      strokeStyle: "dashed",
      rough: "Architect",
      fill: "Solid",
      ...(sharp ? { edges: "Round" as const } : {}),
    },
    { strokeStyle: "dotted", rough: "Cartoonist", fill: "Hachure" },
    { strokeStyle: "solid", rough: "Artist", fill: "none" },
  );
  return v;
};

for (const tool of ["rectangle", "diamond", "ellipse"]) {
  test(`${tool}: every stroke style, width, roughness, fill and edge draws where it is dragged`, async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const ctx = await startDrawing(page);
    for (const [i, style] of shapeVariants(tool).entries()) {
      await drawShape(ctx, tool, i, style);
    }
    await verifyEverything(ctx);
    expect(errors).toEqual([]);
  });
}

test("arrow: types, stroke styles, widths and arrowheads draw where they are dragged", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const ctx = await startDrawing(page);
  const variants: Style[] = [];
  for (const arrowType of ["sharp", "round", "elbow"] as const) {
    for (const strokeStyle of STYLES) {
      variants.push({ arrowType, strokeStyle, width: "medium" });
    }
  }
  variants.push(
    { arrowType: "sharp", strokeStyle: "dotted", width: "thin" },
    { arrowType: "sharp", strokeStyle: "dashed", width: "bold" },
    {
      arrowType: "sharp",
      strokeStyle: "solid",
      width: "medium",
      heads: ["Triangle", "Arrow"],
    },
    { arrowType: "sharp", heads: ["Triangle (outline)", "None"] },
    { arrowType: "sharp", heads: ["None", "None"] },
  );
  for (const [i, style] of variants.entries()) {
    await drawShape(ctx, "arrow", i, style);
  }
  await verifyEverything(ctx);
  expect(errors).toEqual([]);
});

test("line: every stroke style, width and roughness draws where it is dragged", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const ctx = await startDrawing(page);
  const variants: Style[] = [];
  for (const strokeStyle of STYLES) {
    for (const width of WIDTHS) {
      variants.push({ strokeStyle, width });
    }
  }
  variants.push(
    { strokeStyle: "solid", width: "medium", rough: "Architect" },
    { rough: "Artist" },
    { rough: "Cartoonist" },
  );
  for (const [i, style] of variants.entries()) {
    await drawShape(ctx, "line", i, style);
  }
  await verifyEverything(ctx);
  expect(errors).toEqual([]);
});

test("freedraw: every width draws where it is dragged", async ({ page }) => {
  const errors = trackErrors(page);
  const ctx = await startDrawing(page);
  for (const [i, width] of WIDTHS.entries()) {
    await drawShape(ctx, "freedraw", i, { width });
  }
  await verifyEverything(ctx);
  expect(errors).toEqual([]);
});

test("dark theme and zoom 2: dotted, dashed and solid shapes draw where they are dragged", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const ctx = await startDrawing(page);
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
  await dialog
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: "Dark" })
    .click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Close Settings" }).click();
  for (let k = 0; k < 10; k++) {
    await page.getByRole("button", { name: "Zoom in" }).click();
  }
  await expect.poll(async () => (await live(page)).zoom).toBeGreaterThan(1.9);
  // the visible window at this zoom
  ctx.origin = (i) => ({
    x: 290 + (i % 3) * 120,
    y: 250 + Math.floor(i / 3) * 90,
  });
  let i = 0;
  for (const tool of ["rectangle", "arrow", "line"]) {
    for (const strokeStyle of STYLES) {
      await drawShape(
        ctx,
        tool,
        i++,
        { strokeStyle, width: "medium" },
        { w: 60, h: 40 },
      );
    }
  }
  expect(errors).toEqual([]);
});

test("text and frame are drawn where they are placed", async ({ page }) => {
  const errors = trackErrors(page);
  const ctx = await startDrawing(page);
  const { page: p } = ctx;
  // text: click and type
  await toolButton(p, "text").click();
  const t = await toClient(p, 200, 200);
  await p.mouse.click(t.x, t.y);
  await p.keyboard.type("Shapes");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(200);
  const text = (await live(p)).elements.find((e) => e.type === "text")!;
  nearly(text.x, 200, 3);
  expect(Math.abs(text.y - 200)).toBeLessThan(40);
  const tb = await sceneBox(p, text.x, text.y, text.width, text.height, 8);
  expect((await inkCounts(p, [tb], tb)).within).toBeGreaterThan(8);
  // frame: through the "More tools" menu
  await p.locator(".App-toolbar__extra-tools-trigger").click();
  await p.getByRole("menuitem", { name: /Frame/ }).first().click();
  const from = await toClient(p, 500, 200);
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(from.x + 100, from.y + 60, { steps: 4 });
  await p.waitForTimeout(80);
  const frameMid = (await live(p)).elements.at(-1)!;
  expect(frameMid.type).toBe("frame");
  nearly(frameMid.x, 500);
  nearly(frameMid.y, 200);
  await p.mouse.move(from.x + 240, from.y + 140, { steps: 4 });
  await p.mouse.up();
  const frame = (await live(p)).elements.find((e) => e.type === "frame")!;
  nearly(frame.x, 500);
  nearly(frame.y, 200);
  nearly(frame.width, 240);
  nearly(frame.height, 140);
  expect(errors).toEqual([]);
});

test("SVG export keeps dashed and dotted strokes", async ({ page }) => {
  const errors = trackErrors(page);
  const ctx = await startDrawing(page);
  await drawShape(ctx, "rectangle", 0, {
    strokeStyle: "solid",
    width: "medium",
  });
  await drawShape(ctx, "rectangle", 1, {
    strokeStyle: "dashed",
    width: "medium",
  });
  await drawShape(ctx, "rectangle", 2, {
    strokeStyle: "dotted",
    width: "medium",
  });
  await drawShape(ctx, "arrow", 3, { strokeStyle: "dotted", width: "medium" });
  // the last shape is still selected, and the dialog exports only a selection
  await page.keyboard.press("Escape");
  await openExportDialogFromMenu(page);
  await exportDialogButton(page, "SVG").click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__vaultRepo.exported.length),
    )
    .toBeGreaterThan(0);
  const svg: string = await page.evaluate(() =>
    new TextDecoder().decode((window as any).__vaultRepo.exported.at(-1).bytes),
  );
  const dashes = [...svg.matchAll(/stroke-dasharray="([^"]+)"/g)].map(
    (m) => m[1],
  );
  expect(
    dashes.length,
    "dashed and dotted strokes carry a dash array",
  ).toBeGreaterThan(0);
  expect(
    new Set(dashes).size,
    "dashed and dotted use different dash arrays",
  ).toBeGreaterThanOrEqual(2);
  // the solid rectangle still has plain strokes
  const paths = svg.match(/<path[^>]*>/g) ?? [];
  expect(
    paths.some(
      (t) => t.includes('stroke="#1e1e1e"') && !t.includes("stroke-dasharray"),
    ),
    "a solid stroke has no dash array",
  ).toBe(true);
  expect(errors).toEqual([]);
});
