import { expect, test, type Page } from "@playwright/test";

import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  SHOTS,
  trackErrors,
} from "./helpers";

/** A 19-element tree diagram (7 boxes, 6 connectors, 6 labels) with stock
 *  colours, like the one from the manual test. */
const treeItem = (id: string, name?: string) => {
  const els: any[] = [];
  const base = {
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    version: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };
  const nodes = [
    [300, 0],
    [140, 140],
    [460, 140],
    [60, 280],
    [220, 280],
    [380, 280],
    [540, 280],
  ];
  nodes.forEach(([x, y], i) => {
    els.push({
      ...base,
      id: `${id}-n${i}`,
      type: "rectangle",
      x,
      y,
      width: 100,
      height: 60,
      seed: i + 1,
      versionNonce: i + 1,
    });
  });
  const edges = [
    [0, 1],
    [0, 2],
    [1, 3],
    [1, 4],
    [2, 5],
    [2, 6],
  ];
  edges.forEach(([a, b], i) => {
    const [ax, ay] = nodes[a];
    const [bx, by] = nodes[b];
    els.push({
      ...base,
      id: `${id}-e${i}`,
      type: "line",
      x: ax + 50,
      y: ay + 60,
      width: Math.abs(bx - ax),
      height: by - ay - 60,
      points: [
        [0, 0],
        [bx - ax, by - ay - 60],
      ],
      seed: 100 + i,
      versionNonce: 100 + i,
    });
  });
  for (let i = 1; i < 7; i++) {
    const [x, y] = nodes[i];
    els.push({
      ...base,
      id: `${id}-t${i}`,
      type: "text",
      x: x + 38,
      y: y + 18,
      width: 24,
      height: 25,
      text: String(i),
      originalText: String(i),
      fontSize: 20,
      fontFamily: 5,
      textAlign: "center",
      verticalAlign: "top",
      containerId: null,
      lineHeight: 1.25,
      seed: 200 + i,
      versionNonce: 200 + i,
    });
  }
  return {
    id,
    status: "unpublished",
    created: 1,
    ...(name ? { name } : {}),
    elements: els,
  };
};

const rectItem = (id: string, name: string | undefined, color: string) => ({
  id,
  status: "unpublished",
  created: 1,
  ...(name ? { name } : {}),
  elements: [
    {
      ...treeItem("x").elements[0],
      id: `${id}-r`,
      strokeColor: color,
      backgroundColor: "#a5d8ff",
      fillStyle: "hachure",
      width: 120,
      height: 80,
    },
  ],
});

const libJson = (items: unknown[]) =>
  JSON.stringify({
    type: "excalidrawlib",
    version: 2,
    source: "https://excalidraw.com",
    libraryItems: items,
  });

const seedPersonal = (page: Page, items: unknown[]) =>
  page.evaluate((json) => {
    (window as any).__libraryRepo.setFile("personal", json);
  }, libJson(items));

const seedVault = (page: Page, items: unknown[]) =>
  page.evaluate((json) => {
    const handle = (window as any).__vaultRepo.handle;
    (window as any).__libraryRepo.setFile("vault", json, handle);
  }, libJson(items));

const fileItems = async (
  page: Page,
  scope: "personal" | "vault",
): Promise<any[]> => {
  const raw = await page.evaluate((s) => {
    const h = (window as any).__vaultRepo.handle;
    return (window as any).__libraryRepo.getJson(
      s,
      s === "vault" ? h : undefined,
    );
  }, scope);
  return raw ? JSON.parse(raw).libraryItems : [];
};
const nameIn = async (page: Page, scope: "personal" | "vault", id: string) =>
  (await fileItems(page, scope)).find((item) => item.id === id)?.name;

const tile = (page: Page, id: string) => page.getByTestId(`library-unit-${id}`);
const tileName = (page: Page, id: string) =>
  tile(page, id).getByTestId("library-item-name");

const openLibrary = async (page: Page) => {
  if (!(await page.getByTestId("library-section-personal").isVisible())) {
    await page.locator(".default-sidebar-trigger").first().click();
  }
  await expect(page.getByTestId("library-section-personal")).toBeVisible();
};

const setup = async (page: Page, vaultItems: unknown[] = []) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await seedPersonal(page, [
    treeItem("tree", "Binary tree"),
    rectItem("box", "A box with a rather long name that ellipsizes", "#1971c2"),
    rectItem("plain", undefined, "#e03131"),
  ]);
  if (vaultItems.length) {
    await seedVault(page, vaultItems);
  }
  await openLibrary(page);
  await expect(page.locator(".library-unit svg")).toHaveCount(
    3 + vaultItems.length,
  );
  return errors;
};

const shoot = async (page: Page, name: string) => {
  if (process.env.LIBRARY_SHOTS === "1") {
    await page.waitForTimeout(300);
    await page
      .locator(".default-sidebar")
      .screenshot({ path: `${SHOTS}/library-names-${name}.png` });
  }
};

test("library previews: light, dark, Dracula with sync", async ({ page }) => {
  const errors = await setup(page);
  await shoot(page, "light");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(300);
  await shoot(page, "dark");

  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Dracula" }).click();
  await dialog.getByRole("switch", { name: /Sync canvas with theme/ }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await openLibrary(page);
  await shoot(page, "dracula-sync");
  // hover preview, beside the tile
  await tile(page, "tree").locator(".library-unit__preview").hover();
  await expect(page.getByTestId("library-item-hover-preview")).toBeVisible();
  if (process.env.LIBRARY_SHOTS === "1") {
    const sidebar = (await page.locator(".default-sidebar").boundingBox())!;
    await page.screenshot({
      path: `${SHOTS}/library-names-dracula-hover.png`,
      clip: {
        x: sidebar.x - 280,
        y: sidebar.y,
        width: sidebar.width + 280,
        height: 420,
      },
    });
  }
  expect(errors).toEqual([]);
});

test.describe("library item names", () => {
  test("names, neutral label for unnamed, ellipsis with full name in the title tooltip", async ({
    page,
  }) => {
    const errors = await setup(page);
    await expect(tileName(page, "tree")).toHaveText("Binary tree");
    await expect(tileName(page, "plain")).toHaveText("Untitled");
    await expect(tileName(page, "plain")).toHaveClass(/--untitled/);
    // long name is ellipsized
    const truncated = await tileName(page, "box").evaluate(
      (el) => el.scrollWidth > el.clientWidth,
    );
    expect(truncated).toBe(true);
    await tileName(page, "box").hover();
    await expect(page.locator(".excalidraw-tooltip--visible")).toHaveText(
      "A box with a rather long name that ellipsizes",
    );
    expect(errors).toEqual([]);
  });

  test("rename by double-click saves the name to the item's own file", async ({
    page,
  }) => {
    const errors = await setup(page, [rectItem("v1", undefined, "#2f9e44")]);
    // Personal item
    await tileName(page, "plain").dblclick();
    const input = page.getByTestId("library-item-name-input");
    await expect(input).toBeFocused();
    await input.fill("Red box");
    await input.press("Enter");
    await expect(tileName(page, "plain")).toHaveText("Red box");
    await expect.poll(() => nameIn(page, "personal", "plain")).toBe("Red box");

    // Vault item: written to the vault file, personal untouched
    await tileName(page, "v1").dblclick();
    await page.getByTestId("library-item-name-input").fill("  Green box  ");
    await page.getByTestId("library-item-name-input").press("Enter");
    await expect.poll(() => nameIn(page, "vault", "v1")).toBe("Green box");
    expect((await fileItems(page, "personal")).map((i) => i.id)).toEqual([
      "tree",
      "box",
      "plain",
    ]);

    // Escape cancels
    await tileName(page, "v1").dblclick();
    await page.getByTestId("library-item-name-input").fill("nope");
    await page.getByTestId("library-item-name-input").press("Escape");
    await expect(tileName(page, "v1")).toHaveText("Green box");
    // ...and doesn't close the sidebar
    await expect(page.getByTestId("library-section-personal")).toBeVisible();

    // A name is required: clearing it keeps the old name
    await tileName(page, "v1").dblclick();
    await page.getByTestId("library-item-name-input").fill("");
    await page.getByTestId("library-item-name-input").press("Enter");
    await expect(page.getByTestId("library-item-name-input")).toBeFocused();
    await page.getByTestId("library-item-name-input").press("Escape");
    await expect(tileName(page, "v1")).toHaveText("Green box");
    expect(await nameIn(page, "vault", "v1")).toBe("Green box");
    expect(errors).toEqual([]);
  });

  test("right-click opens the item's menu with Rename", async ({ page }) => {
    const errors = await setup(page);
    await tile(page, "tree").click({ button: "right" });
    await page.getByTestId("lib-dropdown--rename").click();
    const input = page.getByTestId("library-item-name-input");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("Binary tree");
    await input.fill("Tree");
    await input.press("Enter");
    await expect.poll(() => nameIn(page, "personal", "tree")).toBe("Tree");
    expect(errors).toEqual([]);
  });

  test("adding asks for a name first: Esc cancels, empty Enter waits, Enter adds", async ({
    page,
  }) => {
    const errors = await setup(page);
    const before = (await fileItems(page, "personal")).length;
    const writes = () =>
      page.evaluate(() => (window as any).__libraryRepo.writes.length);
    // Select everything on the canvas, then open the library: the add tile
    await page
      .locator(".default-sidebar")
      .getByRole("button", { name: "Close" })
      .click();
    const box = await canvasBox(page);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 20);
    await page.keyboard.press("Control+a");
    await page.keyboard.press("ControlOrMeta+a");
    await openLibrary(page);
    const personal = page
      .getByTestId("library-section-personal")
      .locator("xpath=following-sibling::*[1]");
    const adder = personal.locator(".library-unit__adder");
    const input = page.getByTestId("library-item-name-input");

    // Esc cancels the add
    await adder.click({ force: true });
    await expect(input).toBeFocused();
    await input.press("Escape");
    await expect(input).toHaveCount(0);
    const writesAfterCancel = await writes();
    await page.waitForTimeout(800);
    expect(await writes()).toBe(writesAfterCancel);
    expect((await fileItems(page, "personal")).length).toBe(before);

    // Empty Enter does nothing; a name adds it
    await adder.click({ force: true });
    await input.press("Enter");
    await expect(input).toBeFocused();
    await input.fill("Graph");
    await input.press("Enter");
    await expect
      .poll(async () => (await fileItems(page, "personal")).length)
      .toBe(before + 1);
    expect((await fileItems(page, "personal"))[0].name).toBe("Graph");
    expect(errors).toEqual([]);
  });

  test("canvas context menu Add to library asks for the name in the sidebar", async ({
    page,
  }) => {
    const errors = await setup(page);
    const before = (await fileItems(page, "personal")).length;
    await page
      .locator(".default-sidebar")
      .getByRole("button", { name: "Close" })
      .click();
    await expect(page.getByTestId("library-section-personal")).toBeHidden();
    // draw a rectangle (it stays selected), right-click inside it
    const box = await canvasBox(page);
    await page
      .locator(".vault-editor [data-testid='toolbar-rectangle']")
      .click();
    const x0 = box.x + box.width * 0.3;
    const y0 = box.y + box.height * 0.6;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 140, y0 + 90, { steps: 5 });
    await page.mouse.up();
    await page.mouse.click(x0 + 70, y0 + 45, { button: "right" });
    await page.getByText("Add to library", { exact: true }).click();
    const input = page.getByTestId("library-item-name-input");
    await expect(input).toBeFocused();
    expect((await fileItems(page, "personal")).length).toBe(before);
    await input.fill("From menu");
    await input.press("Enter");
    await expect
      .poll(async () => (await fileItems(page, "personal"))[0]?.name)
      .toBe("From menu");
    expect(errors).toEqual([]);
  });

  test("search matches names and text inside items", async ({ page }) => {
    const errors = await setup(page);
    const search = page.getByPlaceholder("Search library");
    await search.fill("binary");
    await expect(page.locator(".library-unit[data-testid]")).toHaveCount(1);
    await expect(tile(page, "tree")).toBeVisible();
    // the tree's labels are text elements ("1".."6")
    await search.fill("4");
    await expect(tile(page, "tree")).toBeVisible();
    await search.fill("ellipsizes");
    await expect(tile(page, "box")).toBeVisible();
    await expect(page.locator(".library-unit[data-testid]")).toHaveCount(1);
    await search.fill("zzz");
    await expect(page.getByText("No matching items found...")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("hover shows a larger preview beside the tile; click and drag still insert", async ({
    page,
  }) => {
    const errors = await setup(page);
    const preview = page.getByTestId("library-item-hover-preview");
    await tile(page, "tree").locator(".library-unit__preview").hover();
    await expect(preview).toBeVisible();
    await expect(preview.locator("svg")).toHaveCount(1);
    const p = (await preview.boundingBox())!;
    const t = (await tile(page, "tree").boundingBox())!;
    expect(p.width).toBeGreaterThan(t.width * 2);
    const overlaps =
      p.x < t.x + t.width &&
      p.x + p.width > t.x &&
      p.y < t.y + t.height &&
      p.y + p.height > t.y;
    expect(overlaps).toBe(false);
    await page.mouse.move(5, 5);
    await expect(preview).toHaveCount(0);

    // drag: the dragger still serialises the item id
    const dragData = await tile(page, "tree")
      .locator(".library-unit__dragger")
      .evaluate((el) => {
        const dt = new DataTransfer();
        el.dispatchEvent(
          new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }),
        );
        return dt.getData("application/vnd.excalidrawlib.ids+json");
      });
    expect(JSON.parse(dragData).itemIds).toEqual(["tree"]);

    // click inserts the item
    const before = await page.evaluate(() =>
      (window as any).__excalidrawAPI
        ? (window as any).__excalidrawAPI.getSceneElements().length
        : null,
    );
    await tile(page, "box").locator(".library-unit__dragger").click();
    if (before !== null) {
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as any).__excalidrawAPI.getSceneElements().length,
          ),
        )
        .toBe(before + 1);
    } else {
      await expect
        .poll(
          async () =>
            (
              await readScene(page, "DSA/Graphs.excalidraw")
            ).elements.some(
              (e: any) => e.id !== "box-r" && e.backgroundColor === "#a5d8ff",
            ),
          { timeout: 10_000 },
        )
        .toBe(true);
    }
    expect(errors).toEqual([]);
  });
});

// E2E_PERF=1: 2,000-item library, sidebar open. Previews render lazily, so
// only tiles near the viewport are exported to SVG. Also runs on a baseline
// checkout (generic selectors only).
test.describe("library previews perf", () => {
  test.skip(process.env.E2E_PERF !== "1", "set E2E_PERF=1");
  const runs = Number(process.env.PERF_RUNS ?? 3);
  for (const rate of [1, 6]) {
    for (let run = 1; run <= runs; run++) {
      test(`2,000 items: sidebar open cpu${rate}x run${run}`, async ({
        page,
        browserName,
      }) => {
        test.skip(rate !== 1 && browserName !== "chromium", "CDP throttle");
        await openVault(page);
        await page
          .locator(".vault-tree-item__name", { hasText: "DSA" })
          .first()
          .click();
        await openDrawing(page, "Graphs");
        const items = Array.from({ length: 2000 }, (_, i) =>
          i % 10 === 0
            ? treeItem(`t${i}`, `Tree ${i}`)
            : rectItem(`r${i}`, `Box ${i}`, "#1971c2"),
        );
        await seedPersonal(page, items);
        await page.waitForTimeout(2500);
        await page.evaluate(() => {
          const w = window as any;
          w.__longest = 0;
          w.__longTotal = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              w.__longest = Math.max(w.__longest, e.duration);
              w.__longTotal += e.duration;
            }
          }).observe({ type: "longtask", buffered: false } as any);
        });
        const cdp =
          browserName === "chromium"
            ? await page.context().newCDPSession(page)
            : null;
        await cdp?.send("Emulation.setCPUThrottlingRate", { rate });
        const t0 = Date.now();
        await page.locator(".default-sidebar-trigger").first().click();
        await expect(page.locator(".library-unit svg").first()).toBeVisible({
          timeout: 60_000,
        });
        const firstPreviewMs = Date.now() - t0;
        await page.waitForTimeout(rate === 1 ? 3000 : 10000);
        const res = await page.evaluate(() => ({
          svgs: document.querySelectorAll(".library-unit svg").length,
          tiles: document.querySelectorAll(".library-unit").length,
          longest: Math.round((window as any).__longest),
          longTotal: Math.round((window as any).__longTotal),
          heapMB: (performance as any).memory
            ? Math.round((performance as any).memory.usedJSHeapSize / 1e6)
            : null,
        }));
        await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        // eslint-disable-next-line no-console
        console.log(
          `PERF_NAMES ${JSON.stringify({
            tag: process.env.PERF_TAG ?? "ours",
            browserName,
            rate,
            run,
            firstPreviewMs,
            ...res,
          })}`,
        );
      });
    }
  }
});
