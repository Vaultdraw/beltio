import { expect, test, type Page } from "@playwright/test";

import { AFTER_AUTOSAVE_MS } from "./constants";
import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "./helpers";
import {
  A4,
  dragTool,
  focusCanvas,
  hex,
  live,
  near,
  PAGE_SHOTS,
  pixelAtClient,
  pixelAtScene,
  rect,
  runCommand,
  seed,
  seedAndOpen,
  setupOf,
  toClient,
} from "./pageHelpers";

// Page mode (simulated pages, vertical scroll, blocked outside, auto-extend,
// paper themes, PDF-free parts). PDF export lives in pdfExport.spec.ts.

const PITCH = A4.height + 40;
const SURROUND_LIGHT = "#e4e4e7";
const SURROUND_DARK = "#1b1b1f";

const wheel = async (page: Page, dx: number, dy: number, ctrl = false) => {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  if (ctrl) {
    await page.keyboard.down("Control");
  }
  await page.mouse.wheel(dx, dy);
  if (ctrl) {
    await page.keyboard.up("Control");
  }
  await page.waitForTimeout(120);
};

/** Wheel-scrolls until scene y `sy` sits in the visible middle of the canvas. */
const scrollIntoView = async (page: Page, sy: number) => {
  const box = await canvasBox(page);
  for (let i = 0; i < 40; i++) {
    const c = await toClient(page, 0, sy);
    if (c.y > box.y + 160 && c.y < box.y + box.height - 160) {
      return;
    }
    await wheel(page, 0, c.y < box.y + 160 ? -150 : 150);
  }
};

const saved = (page: Page, path: string) => readScene(page, path);

const openSettings = async (page: Page) => {
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
};

const inPageColumn = (
  e: { x: number; y: number; width: number; height: number },
  s = setupOf(),
) => {
  const pitch = s.height + 40;
  const i = Math.max(0, Math.floor((e.y + e.height / 2) / pitch));
  return (
    e.x >= -0.5 &&
    e.x + e.width <= s.width + 0.5 &&
    e.y >= i * pitch - 0.5 &&
    e.y + e.height <= i * pitch + s.height + 0.5
  );
};

test.beforeEach(async ({ page }) => {
  await openVault(page);
});

test("mode switch via the palette is saved in the file and reopens the same", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seedAndOpen(page, "Old.excalidraw", { elements: [rect("a", 50, 50)] });
  await seed(page, "Other.excalidraw");
  expect((await live(page)).pageSetup).toBeNull();
  expect((await live(page)).hasConstraints).toBe(false);

  await runCommand(page, "Page mode: On");
  await expect
    .poll(
      async () =>
        (
          await saved(page, "Old.excalidraw")
        ).appState.pageSetup?.enabled,
    )
    .toBe(true);
  expect((await live(page)).hasConstraints).toBe(true);

  // away and back
  await openDrawing(page, "Other");
  await openDrawing(page, "Old");
  const reopened = await live(page);
  expect(reopened.pageSetup?.enabled).toBe(true);
  expect(reopened.hasConstraints).toBe(true);

  await runCommand(page, "Page mode: Off");
  await expect
    .poll(
      async () =>
        (
          await saved(page, "Old.excalidraw")
        ).appState.pageSetup?.enabled,
    )
    .toBe(false);
  expect((await live(page)).hasConstraints).toBe(false);
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  expect(errors).toEqual([]);
});

test("an old file without the field opens in Normal mode", async ({ page }) => {
  await seedAndOpen(page, "Legacy.excalidraw", {
    elements: [rect("a", 5000, 5000)],
  });
  const st = await live(page);
  expect(st.pageSetup).toBeNull();
  expect(st.hasConstraints).toBe(false);
  // free horizontal pan still works
  await wheel(page, 300, 0);
  expect((await live(page)).scrollX).not.toBe(st.scrollX);
});

test("vertical-only scroll, centred zoom, zoom-out floor, resize keeps the lock", async ({
  page,
}) => {
  await seedAndOpen(page, "Scroll.excalidraw", {
    pageSetup: setupOf({ pageCount: 3 }),
  });
  const fit = (await live(page)).zoom;
  const w0 = (await live(page)).width;
  expect(fit).toBeCloseTo((w0 - 48) / A4.width, 2);
  const s0 = await live(page);

  await wheel(page, 250, 0);
  expect((await live(page)).scrollX).toBeCloseTo(s0.scrollX, 3);
  await wheel(page, 0, 400);
  const s1 = await live(page);
  expect(s1.scrollY).toBeLessThan(s0.scrollY - 100);
  expect(s1.scrollX).toBeCloseTo(s0.scrollX, 3);
  await wheel(page, -300, -300); // diagonal: only the vertical part counts
  expect((await live(page)).scrollX).toBeCloseTo(s0.scrollX, 3);

  const centred = async () => {
    const st = await live(page);
    const box = await canvasBox(page);
    const cx = (A4.width / 2 + st.scrollX) * st.zoom;
    return Math.abs(cx - box.width / 2);
  };
  expect(await centred()).toBeLessThan(2);

  // zoom in: bigger, page still centred horizontally
  await wheel(page, 0, -200, true);
  const zin = await live(page);
  expect(zin.zoom).toBeGreaterThan(fit * 1.05);
  expect(await centred()).toBeLessThan(3);

  // zoom out a lot: floor at half the fit zoom, page centred
  for (let i = 0; i < 25; i++) {
    await wheel(page, 0, 400, true);
  }
  const zout = await live(page);
  expect(zout.zoom).toBeGreaterThanOrEqual(fit * 0.5 - 0.005);
  expect(zout.zoom).toBeLessThan(fit * 0.5 + 0.02);
  expect(await centred()).toBeLessThan(3);

  // window resize: re-fits and keeps the lock
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForTimeout(600);
  const r = await live(page);
  expect(r.hasConstraints).toBe(true);
  expect(r.width).toBeLessThan(w0);
  expect(r.zoom).toBeGreaterThan(((r.width - 48) / A4.width) * 0.45);
  expect(r.zoom).toBeLessThan(((r.width - 48) / A4.width) * 1.01);
  await wheel(page, 300, 0);
  const afterWheel = await live(page);
  const before = afterWheel.scrollX;
  await wheel(page, 300, 0);
  expect((await live(page)).scrollX).toBeCloseTo(before, 3);
});

test("blocking: nothing starts in the surround, drags clamp to the page, duplicate and paste end inside", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seedAndOpen(page, "Block.excalidraw", {
    pageSetup: setupOf(),
    elements: [rect("edge", 670, 100)],
  });
  const box = await canvasBox(page);

  // start in the surround (left margin)
  const inside = await toClient(page, 300, 300);
  await dragTool(page, "r", { x: box.x + 8, y: inside.y }, inside);
  expect((await live(page)).elements.map((e) => e.id)).toEqual(["edge"]);

  // start inside, end beyond the right edge
  const a = await toClient(page, 500, 400);
  await dragTool(page, "r", a, { x: box.x + box.width - 2, y: a.y + 90 });
  let els = (await live(page)).elements;
  expect(els.length).toBe(2);
  const created = els.find((e) => e.id !== "edge")!;
  expect(created.x + created.width).toBeLessThanOrEqual(A4.width + 0.5);
  expect(created.width).toBeGreaterThan(100);

  // duplicate the element at the edge: the copy is pulled inside
  await page.keyboard.press("v");
  const edge = await toClient(page, 670, 140);
  await page.mouse.click(edge.x, edge.y);
  await page.keyboard.press("Meta+d");
  await page.waitForTimeout(600);
  els = (await live(page)).elements;
  expect(els.length).toBe(3);
  for (const e of els) {
    expect(e.x + e.width, e.id).toBeLessThanOrEqual(A4.width + 0.5);
  }

  // copy, then paste with the pointer near the right edge
  await page.keyboard.press("Meta+c");
  const near = await toClient(page, 780, 700);
  await page.mouse.move(near.x, near.y);
  await page.keyboard.press("Meta+v");
  await page.waitForTimeout(700);
  els = (await live(page)).elements;
  expect(els.length).toBeGreaterThanOrEqual(4);
  for (const e of els) {
    expect(inPageColumn(e), e.id).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("separate pages: a drag lands fully on a page, never straddling a gap", async ({
  page,
}) => {
  const s = setupOf({ size: "custom", width: 600, height: 300, pageCount: 3 });
  await seedAndOpen(page, "Sep.excalidraw", {
    pageSetup: s,
    elements: [rect("r", 100, 100, 100, 60)],
  });
  for (let i = 0; i < 25; i++) {
    await wheel(page, 0, 400, true);
  }
  const pitch = 340;
  const grab = async (sy: number) => {
    const c = await toClient(page, 150, sy);
    await page.mouse.move(c.x, c.y);
    return c;
  };
  const dragBy = async (sy: number, dy: number) => {
    const c = await grab(sy);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y + (dy * (await live(page)).zoom) / 2, {
      steps: 5,
    });
    await page.mouse.move(c.x, c.y + dy * (await live(page)).zoom, {
      steps: 8,
    });
    await page.mouse.up();
    await page.waitForTimeout(500);
  };
  // select first
  const sel = await toClient(page, 100, 130);
  await page.keyboard.press("v");
  await page.mouse.click(sel.x, sel.y);

  await dragBy(130, 340); // onto page 2 (index 1)
  let e = (await live(page)).elements[0];
  expect(e.y).toBeGreaterThanOrEqual(pitch - 0.5);
  expect(e.y + e.height).toBeLessThanOrEqual(pitch + 300 + 0.5);

  // release with the centre in the gap (gap = 300..340 above page index 1)
  const cy = e.y + e.height / 2;
  await dragBy(cy, 320 - cy);
  e = (await live(page)).elements[0];
  expect(inPageColumn(e, s)).toBe(true);
  const i = Math.floor((e.y + e.height / 2) / pitch);
  expect(e.y).toBeGreaterThanOrEqual(i * pitch - 0.5);
  expect(e.y + e.height).toBeLessThanOrEqual(i * pitch + 300 + 0.5);
});

test("auto-extend: drawing in the last quarter adds a page that renders", async ({
  page,
}) => {
  await seedAndOpen(page, "Ext.excalidraw", { pageSetup: setupOf() });
  await wheel(page, 0, 3000);
  const a = await toClient(page, 200, 900);
  const b = await toClient(page, 360, 1000);
  await dragTool(page, "r", a, b);
  await expect
    .poll(async () => (await live(page)).pageSetup?.pageCount)
    .toBe(2);
  await expect
    .poll(
      async () =>
        (
          await saved(page, "Ext.excalidraw")
        ).appState.pageSetup?.pageCount,
    )
    .toBe(2);
  await scrollIntoView(page, A4.height + 20);
  // a sheet 2 pixel is paper white, the gap the surround
  await page.waitForTimeout(200);
  expect(
    near(await pixelAtScene(page, 700, PITCH + 100), [255, 255, 255]),
  ).toBe(true);
  expect(
    near(await pixelAtScene(page, 400, A4.height + 20), hex(SURROUND_LIGHT)),
  ).toBe(true);
});

// keep in sync with PAGE_TOP_MARGIN in src/page/pageView.ts
const PAGE_TOP_MARGIN = 72;

test("PageDown and PageUp move one page", async ({ page }) => {
  await seedAndOpen(page, "Nav.excalidraw", {
    pageSetup: setupOf({ pageCount: 3 }),
  });
  await focusCanvas(page);
  const expected = (i: number, z: number) => -(i * PITCH) + PAGE_TOP_MARGIN / z;
  const z = (await live(page)).zoom;
  await page.keyboard.press("PageDown");
  await expect
    .poll(async () => (await live(page)).scrollY)
    .toBeCloseTo(expected(1, z), 0);
  await page.keyboard.press("PageDown");
  await expect
    .poll(async () => (await live(page)).scrollY)
    .toBeCloseTo(expected(2, z), 0);
  await page.keyboard.press("PageUp");
  await expect
    .poll(async () => (await live(page)).scrollY)
    .toBeCloseTo(expected(1, z), 0);
  await page.keyboard.press("PageUp");
  await expect
    .poll(async () => (await live(page)).scrollY)
    .toBeCloseTo(expected(0, z), 0);
});

const emptyPagePoint = { x: 700, y: 560 };

test("paper themes: Normal white, Old school cream, surround and gap colours (light)", async ({
  page,
}) => {
  const s = setupOf({ size: "custom", width: 600, height: 300, pageCount: 2 });
  await seedAndOpen(page, "Paper.excalidraw", { pageSetup: s });
  const sample = async () => {
    const box = await canvasBox(page);
    return {
      page: await pixelAtScene(page, 300, 150),
      surround: await pixelAtClient(page, box.x + 4, box.y + box.height / 2),
      gap: await pixelAtScene(page, 300, 320),
    };
  };
  let p = await sample();
  expect(near(p.page, [255, 255, 255])).toBe(true);
  expect(near(p.surround, hex(SURROUND_LIGHT))).toBe(true);
  expect(near(p.gap, hex(SURROUND_LIGHT))).toBe(true);

  await runCommand(page, "Paper theme: Old school");
  p = await sample();
  expect(near(p.page, hex("#f8efd4"), 4)).toBe(true);
  expect(near(p.gap, hex(SURROUND_LIGHT))).toBe(true);

  await runCommand(page, "Paper theme: Normal");
  expect(near((await sample()).page, [255, 255, 255])).toBe(true);
  expect(emptyPagePoint.x).toBe(700);
});

test("paper themes in Dracula (dark): Match = theme surface, surround dark, gap = surround", async ({
  page,
}) => {
  const s = setupOf({
    size: "custom",
    width: 600,
    height: 300,
    pageCount: 2,
    paperTheme: "match",
  });
  await seedAndOpen(page, "Dark.excalidraw", { pageSetup: s });
  const dialog = await openSettings(page);
  await dialog.getByRole("radio", { name: "Dracula" }).click();
  await dialog
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: "Dark", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.waitForTimeout(500);
  const surface = hex(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--vault-canvas")
        .trim(),
    ),
  );
  const box = await canvasBox(page);
  const pageColor = await pixelAtScene(page, 300, 150);
  expect(near(pageColor, surface, 3), `page ${pageColor} vs ${surface}`).toBe(
    true,
  );
  const surroundPx = await pixelAtClient(
    page,
    box.x + 4,
    box.y + box.height / 2,
  );
  expect(near(surroundPx, hex(SURROUND_DARK)), `surround ${surroundPx}`).toBe(
    true,
  );
  const gap = await pixelAtScene(page, 300, 320);
  expect(near(gap, hex(SURROUND_DARK)), `gap ${gap}`).toBe(true);

  // Normal stays white paper even in a dark theme; Old school stays cream
  await runCommand(page, "Paper theme: Normal");
  expect(near(await pixelAtScene(page, 300, 150), [255, 255, 255])).toBe(true);
  await runCommand(page, "Paper theme: Old school");
  expect(near(await pixelAtScene(page, 300, 150), hex("#f8efd4"), 4)).toBe(
    true,
  );
});

test("palette: page commands exist and the current choice has a check mark", async ({
  page,
}) => {
  await seedAndOpen(page, "Cmds.excalidraw", { pageSetup: setupOf() });
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const first = async (query: string) => {
    if (!(await palette.isVisible())) {
      await page.keyboard.press("Meta+Shift+KeyP");
      await expect(palette).toBeVisible();
    }
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(`>${query}`);
    const options = palette.getByRole("option");
    await expect(options.first()).toContainText(query);
    return options.first().innerText();
  };
  expect(await first("Page size: A4")).toContain("✓");
  expect(await first("Page size: A5")).not.toContain("✓");
  expect(await first("Page layout: Separate pages")).toContain("✓");
  expect(await first("Page layout: Continuous")).not.toContain("✓");
  expect(await first("Page orientation: Portrait")).toContain("✓");
  expect(await first("Paper theme: Normal")).toContain("✓");
  expect(await first("Paper theme: Old school")).not.toContain("✓");
  expect(await first("Page mode: On")).toContain("✓");
  for (const title of [
    "Page mode: Toggle",
    "Page size: Letter",
    "Page size: Legal",
    "Page size: B5",
    "Page size: A3",
    "Page orientation: Landscape",
    "Page setup",
    "Paper theme: Match current theme",
    "Fit content to page",
    "Next page",
    "Previous page",
    "Export: PDF",
  ]) {
    await first(title);
  }
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  // choosing a size moves the check
  await runCommand(page, "Page size: Letter");
  expect((await live(page)).pageSetup?.size).toBe("letter");
  expect(await first("Page size: Letter")).toContain("✓");
  expect(await first("Page size: A4")).not.toContain("✓");
});

test("Settings > Page defaults give a NEW drawing that setup; Normal default gives none", async ({
  page,
}) => {
  const newDrawing = async () => {
    const before = await page.evaluate(async () => {
      const repo = (window as any).__vaultRepo;
      return (await repo.listDirectory(repo.handle, "")).map(
        (e: any) => e.path,
      );
    });
    // The header button is gone; the command (Mod+N) creates in the current folder.
    await page.keyboard.press("Meta+KeyN");
    await expect(
      page.locator(".vault-editor canvas.interactive"),
    ).toBeVisible();
    await page.waitForTimeout(700);
    const after: string[] = await page.evaluate(async () => {
      const repo = (window as any).__vaultRepo;
      return (await repo.listDirectory(repo.handle, "")).map(
        (e: any) => e.path,
      );
    });
    const path = after.find(
      (p) => !before.includes(p) && /\.excalidraw$/.test(p),
    )!;
    expect(path).toBeTruthy();
    return path;
  };

  const dialog = await openSettings(page);
  await dialog.getByRole("tab", { name: "Page", exact: true }).click();
  await dialog.getByRole("button", { name: "Pages", exact: true }).click();
  await dialog.getByRole("button", { name: "Continuous", exact: true }).click();
  await dialog.getByRole("button", { name: "Landscape", exact: true }).click();
  await dialog.getByRole("button", { name: "Old school", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  const p1 = await newDrawing();
  const st = await live(page);
  expect(st.pageSetup).toMatchObject({
    enabled: true,
    layout: "continuous",
    orientation: "landscape",
    paperTheme: "oldSchool",
  });
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  await expect
    .poll(async () => (await saved(page, p1)).appState.pageSetup?.paperTheme)
    .toBe("oldSchool");
  expect((await saved(page, p1)).appState.pageSetup).toMatchObject({
    layout: "continuous",
    orientation: "landscape",
    width: 1123,
    height: 794,
  });

  const d2 = await openSettings(page);
  await d2.getByRole("tab", { name: "Page", exact: true }).click();
  await d2.getByRole("button", { name: "Normal canvas", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(d2).toHaveCount(0);
  const p2 = await newDrawing();
  expect(p2).not.toBe(p1);
  expect((await live(page)).pageSetup).toBeNull();
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  const file = await saved(page, p2);
  expect(file.appState.pageSetup ?? null).toBeNull();
});

test("Fit content to page on an old drawing: notice, button moves everything inside, nothing deleted", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seedAndOpen(page, "Mess.excalidraw", {
    elements: [
      rect("a", -300, -200),
      rect("b", 1500, 3000),
      rect("c", 100, 100),
    ],
  });
  await runCommand(page, "Page mode: On");
  const notice = page.locator(".page-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(/elements? (is|are) outside the page/);
  // switching on moved nothing
  let els = (await live(page)).elements;
  expect(els.find((e) => e.id === "a")!.x).toBe(-300);
  expect(els.length).toBe(3);

  await notice.getByRole("button", { name: "Fit content to page" }).click();
  await expect(notice).toHaveCount(0);
  els = (await live(page)).elements;
  expect(els.length).toBe(3);
  const setup = (await live(page)).pageSetup!;
  for (const e of els) {
    expect(inPageColumn(e, setup as any), `${e.id} ${e.x},${e.y}`).toBe(true);
  }
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  const file = await saved(page, "Mess.excalidraw");
  expect(file.elements.filter((e: any) => !e.isDeleted).length).toBe(3);
  expect(errors).toEqual([]);
});

test.describe("screenshots", () => {
  const shot = (page: Page, name: string) =>
    page.screenshot({ path: `${PAGE_SHOTS}/${name}.png` });
  const content = [
    rect("a", 80, 80, 300, 160),
    rect("b", 120, 400, 200, 120),
    rect("c", 90, 1000, 260, 140),
  ];

  test("top inset: page 1 clears the floating toolbar", async ({ page }) => {
    await seedAndOpen(page, "Top.excalidraw", {
      pageSetup: setupOf({ pageCount: 2 }),
      elements: content,
    });
    const toolbar = await page.locator(".App-toolbar").first().boundingBox();
    const z = (await live(page)).zoom;
    const s = await live(page);
    const box = (await page
      .locator(".vault-editor canvas.static")
      .boundingBox())!;
    const pageTop = box.y + s.scrollY * z;
    // eslint-disable-next-line no-console
    console.log(
      "TOOLBAR_BOTTOM",
      toolbar && toolbar.y + toolbar.height,
      "PAGE_TOP",
      pageTop,
    );
    expect(pageTop).toBeGreaterThanOrEqual(
      (toolbar?.y ?? 0) + (toolbar?.height ?? 0),
    );
    await shot(page, "top-inset");
  });

  test("continuous and separate layouts", async ({ page }) => {
    await seedAndOpen(page, "Cont.excalidraw", {
      pageSetup: setupOf({ layout: "continuous", pageCount: 3 }),
      elements: content,
    });
    for (let i = 0; i < 25; i++) {
      await wheel(page, 0, 400, true);
    }
    await shot(page, "continuous");
    await seedAndOpen(page, "Sepa.excalidraw", {
      pageSetup: setupOf({
        size: "custom",
        width: 600,
        height: 400,
        pageCount: 2,
      }),
      elements: [rect("a", 60, 60, 240, 120), rect("b", 100, 500, 240, 120)],
    });
    await shot(page, "separate");
  });

  test("Old school / Normal / Match in Dracula", async ({ page }) => {
    await seedAndOpen(page, "Th.excalidraw", {
      pageSetup: setupOf({
        size: "custom",
        width: 600,
        height: 400,
        pageCount: 2,
        paperTheme: "match",
      }),
      elements: [rect("a", 60, 60, 240, 120), rect("b", 100, 500, 240, 120)],
      appState: { viewBackgroundPattern: undefined },
    });
    const dialog = await openSettings(page);
    await dialog.getByRole("radio", { name: "Dracula" }).click();
    await dialog
      .getByRole("group", { name: "Mode" })
      .getByRole("button", { name: "Dark", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.waitForTimeout(400);
    await shot(page, "dracula-match");
    await runCommand(page, "Paper theme: Old school");
    await shot(page, "dracula-old-school");
    await runCommand(page, "Paper theme: Normal");
    await shot(page, "dracula-normal");
  });
});
