import { expect, test, type Page } from "@playwright/test";

import { GRAPH_PLUGIN, openLinksVault, cmdClick, SEED } from "./linksHelpers";
import {
  A,
  B,
  PAIR,
  activeTab,
  clickTree,
  expectShown,
  openSeededVault,
  readTabs,
  sceneIds,
  sceneJson,
  tabByName,
  tabEls,
  tabNames,
  trackErrors,
} from "./tabsHelpers";

// Phase 3 keyboard / palette / behaviour cases. The visible-UI test is in
// tabs.spec.ts.
const C = "Gamma";
const D = "Delta";
const MOD = "Meta";
const FOUR = {
  ...PAIR,
  [`${C}.excalidraw`]: sceneJson([{ id: "c-rect", x: 200, y: 120 }]),
  [`${D}.excalidraw`]: sceneJson([{ id: "d-rect", x: 220, y: 140 }]),
};

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });
const menu = (page: Page) => page.getByTestId("vault-tab-menu");
const list = (page: Page) => page.getByTestId("vault-tab-list");
const tabByPath = (page: Page, name: string) =>
  page.locator(`[data-testid="vault-tab"][data-path="${name}.excalidraw"]`);

/** Opens A, B, C, D each in its own tab (Cmd+click); D is active. */
const openFour = async (page: Page) => {
  await openSeededVault(page, FOUR);
  await clickTree(page, A);
  await expectShown(page, ["a-rect"]);
  for (const [name, id] of [
    [B, "b-ellipse"],
    [C, "c-rect"],
    [D, "d-rect"],
  ]) {
    await clickTree(page, name, [MOD]);
    await expectShown(page, [id]);
  }
};

/** Names of every tab, pinned ones too (they only render an icon). */
const paths = async (page: Page) =>
  (await readTabs(page)).map((t) => t.path.replace(/\.excalidraw$/, ""));

/** Runs a palette command by (part of) its title. */
const runCommand = async (page: Page, query: string, first: string) => {
  await page.keyboard.press(`${MOD}+Shift+KeyP`);
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type(query);
  const opt = palette(page).getByRole("option").first();
  await expect(opt).toContainText(first);
  await page.keyboard.press("Enter");
};

const menuItems = (page: Page) => menu(page).getByRole("menuitem");

/**
 * Context menu of a tab from the keyboard: focus it, Shift+F10. Waits until the
 * menu has focused its first item (it owns the arrow keys from then on): a
 * visible menu alone is not enough under load.
 */
const keyboardMenu = async (page: Page, path: string) => {
  await tabByPath(page, path).focus();
  await expect(tabByPath(page, path)).toBeFocused();
  await page.keyboard.press("Shift+F10");
  await expect(menu(page)).toBeVisible();
  await expect(menuItems(page).first()).toBeFocused();
};

/** ArrowDown `downs` times, checking each step landed, then Enter. */
const pickByKeys = async (page: Page, downs: number) => {
  for (let i = 0; i < downs; i++) {
    await page.keyboard.press("ArrowDown");
    await expect(menuItems(page).nth(i + 1)).toBeFocused();
  }
  await page.keyboard.press("Enter");
};

test.describe("context menu (keyboard)", () => {
  test("Shift+F10 opens it, arrows move, Escape closes and returns focus", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openFour(page);
    await keyboardMenu(page, B);
    const items = menu(page).getByRole("menuitem");
    await expect(items.first()).toBeFocused();
    await expect(items.first()).toHaveText("Close");
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp"); // wraps to the last
    // The last entry is focused. Plugin items (Favourites) come after the
    // built-in groups, so "Open in new window" is not necessarily last.
    await expect(items.last()).toBeFocused();
    await expect(
      items.filter({ hasText: "Open in new window" }),
    ).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(tabByPath(page, B)).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("Enter on Close closes that tab (the menu's own tab, not the active one)", async ({
    page,
  }) => {
    await openFour(page);
    await keyboardMenu(page, B);
    await page.keyboard.press("Enter"); // first item: Close
    await expect(menu(page)).toHaveCount(0);
    expect(await paths(page)).toEqual([A, C, D]);
    expect(await activeTab(page)).toBe(D);
  });

  test("Close others / Close to the right / Close all skip pinned tabs", async ({
    page,
  }) => {
    await openFour(page);
    // Pin A (menu entry 6: Close, others, right, all, | Pin).
    await keyboardMenu(page, A);
    await pickByKeys(page, 4);
    await expect(tabByPath(page, A)).toHaveClass(/vault-tabs__tab--pinned/);

    // Close to the right of B: C and D go, pinned A stays.
    await keyboardMenu(page, B);
    await pickByKeys(page, 2);
    await expect.poll(() => paths(page)).toEqual([A, B]);

    // Reopen C and D, then Close others on C: B and D go, pinned A stays.
    await clickTree(page, C, [MOD]);
    await expectShown(page, ["c-rect"]);
    await clickTree(page, D, [MOD]);
    await expectShown(page, ["d-rect"]);
    await keyboardMenu(page, C);
    await pickByKeys(page, 1);
    await expect.poll(() => paths(page)).toEqual([A, C]);

    // Close all: the pinned tab survives, C goes.
    await keyboardMenu(page, C);
    await pickByKeys(page, 3);
    await expect.poll(() => paths(page)).toEqual([A]);
    await expect(tabByPath(page, A)).toHaveClass(/vault-tabs__tab--pinned/);
  });

  test("the menu's Close works on a pinned tab", async ({ page }) => {
    await openFour(page);
    await keyboardMenu(page, A);
    await pickByKeys(page, 4); // Pin
    await keyboardMenu(page, A);
    await page.keyboard.press("Enter");
    await expect.poll(() => paths(page)).toEqual([B, C, D]);
  });
});

test.describe("drag reorder", () => {
  const dragTab = async (
    page: Page,
    from: string,
    to: string,
    side: "before" | "after",
  ) => {
    const a = (await tabByPath(page, from).boundingBox())!;
    const b = (await tabByPath(page, to).boundingBox())!;
    const y = a.y + a.height / 2;
    const x0 = a.x + a.width / 2;
    const x1 = side === "after" ? b.x + b.width - 6 : b.x + 6;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    await page.mouse.move(x0 + 6, y); // past the 4 px threshold
    await page.mouse.move((x0 + x1) / 2, y, { steps: 4 });
    await page.mouse.move(x1, y, { steps: 4 });
    await page.mouse.up();
  };

  test("dragging a background tab reorders the strip and does not activate it", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openFour(page);
    expect(await paths(page)).toEqual([A, B, C, D]);
    await dragTab(page, A, C, "after");
    await expect.poll(() => paths(page)).toEqual([B, C, A, D]);
    expect(await activeTab(page)).toBe(D);
    expect(await sceneIds(page)).toEqual(["d-rect"]);
    // The click after the drag was swallowed: nothing activated, a real click does.
    await tabByPath(page, A).click();
    await expectShown(page, ["a-rect"]);
    expect(errors).toEqual([]);
  });

  test("a click with under 4 px of movement still activates", async ({
    page,
  }) => {
    await openFour(page);
    const a = (await tabByPath(page, A).boundingBox())!;
    const y = a.y + a.height / 2;
    await page.mouse.move(a.x + 20, y);
    await page.mouse.down();
    await page.mouse.move(a.x + 22, y);
    await page.mouse.up();
    await expectShown(page, ["a-rect"]);
    expect(await paths(page)).toEqual([A, B, C, D]);
  });

  test("an unpinned tab cannot be dropped among pinned ones", async ({
    page,
  }) => {
    await openFour(page);
    await keyboardMenu(page, A);
    await pickByKeys(page, 4); // pin A
    await dragTab(page, D, A, "before");
    await page.waitForTimeout(200);
    // Clamped to the first unpinned slot, never before the pinned tab.
    expect(await paths(page)).toEqual([A, D, B, C]);
  });
});

test.describe("tab list", () => {
  test("Mod+Shift+A opens it, typing filters, Enter switches", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openFour(page);
    await page.keyboard.press(`${MOD}+Shift+KeyA`);
    await expect(list(page)).toBeVisible();
    await expect(page.getByTestId("vault-tab-list-item")).toHaveCount(4);
    await expect(
      page.locator('[data-testid="vault-tab-list-item"][data-active="true"]'),
    ).toContainText(D);
    await page.keyboard.type("bet");
    await expect(page.getByTestId("vault-tab-list-item")).toHaveCount(1);
    await expect(page.getByTestId("vault-tab-list-item")).toContainText(B);
    await page.keyboard.press("Enter");
    await expect(list(page)).toHaveCount(0);
    await expectShown(page, ["b-ellipse"]);
    expect(await activeTab(page)).toBe(B);
    expect(errors).toEqual([]);
  });

  test("the chevron opens it, a click on a row switches, Escape closes", async ({
    page,
  }) => {
    await openFour(page);
    await page.getByTestId("vault-tab-overflow").click();
    await expect(list(page)).toBeVisible();
    await page
      .getByTestId("vault-tab-list-item")
      .filter({ hasText: A })
      .click();
    await expectShown(page, ["a-rect"]);
    await page.getByTestId("vault-tab-overflow").click();
    await expect(list(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list(page)).toHaveCount(0);
  });

  test("narrow strip shows only the active tab and an N / M chip that opens the list", async ({
    page,
  }) => {
    await openFour(page);
    await clickTree(page, B);
    await expectShown(page, ["b-ellipse"]);
    await page.setViewportSize({ width: 520, height: 850 });
    // The strip is narrow when the editor pane is; shrink the navigator-free
    // case too by squeezing the strip itself if the window alone is not enough.
    await page
      .getByTestId("vault-tabs")
      .evaluate((el) => ((el as HTMLElement).style.maxWidth = "190px"));
    const chip = page.getByTestId("vault-tab-count");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText("2 / 4");
    await expect(tabEls(page)).toHaveCount(1);
    expect(await activeTab(page)).toBe(B);
    await chip.click();
    await expect(list(page)).toBeVisible();
    await expect(page.getByTestId("vault-tab-list-item")).toHaveCount(4);
    await page
      .getByTestId("vault-tab-list-item")
      .filter({ hasText: D })
      .click();
    await expect(chip).toHaveText("4 / 4");
    await expectShown(page, ["d-rect"]);
  });
});

test.describe("palette commands", () => {
  test("tabs.focusStrip focuses the active tab", async ({ page }) => {
    await openFour(page);
    await runCommand(page, "Focus tab strip", "Focus tab strip");
    await expect(palette(page)).toHaveCount(0);
    await expect(tabByPath(page, D)).toBeFocused();
  });

  test("tabs.reveal focuses the active drawing's row in the navigator", async ({
    page,
  }) => {
    await openFour(page);
    await tabByPath(page, B).click();
    await expectShown(page, ["b-ellipse"]);
    await runCommand(page, "Reveal in navigator", "Reveal in navigator");
    await expect(palette(page)).toHaveCount(0);
    await expect(page.locator(".vault-tree-item--focused")).toContainText(B);
  });

  test("file.openInNewTab opens the picked drawing in a new tab", async ({
    page,
  }) => {
    await openSeededVault(page, FOUR);
    await clickTree(page, A);
    await expectShown(page, ["a-rect"]);
    await runCommand(
      page,
      "Open drawing in new tab",
      "Open drawing in new tab",
    );
    await expect(palette(page)).toBeVisible();
    await page.keyboard.type("Gamma");
    await expect(palette(page).getByRole("option").first()).toContainText(C);
    await page.keyboard.press("Enter");
    await expectShown(page, ["c-rect"]);
    expect(await tabNames(page)).toEqual([A, C]);
    expect(await activeTab(page)).toBe(C);
  });
});

test.describe("missing tabs", () => {
  const externalDelete = (page: Page, name: string) =>
    page.evaluate(
      (p) => (window as any).__vaultRepo.externalDelete(p),
      `${name}.excalidraw`,
    );
  const externalRestore = (page: Page, name: string, json: string) =>
    page.evaluate(
      ([p, j]) => (window as any).__vaultRepo.externalWrite(p, j),
      [`${name}.excalidraw`, json],
    );

  test("an outside delete marks a background tab, the placeholder shows, restore clears", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openSeededVault(page, PAIR);
    await clickTree(page, A);
    await expectShown(page, ["a-rect"]);
    await clickTree(page, B, [MOD]);
    await expectShown(page, ["b-ellipse"]);

    await externalDelete(page, A);
    await expect(tabByName(page, A)).toHaveClass(/vault-tabs__tab--missing/, {
      timeout: 5000,
    });
    // The shown tab is untouched.
    await expect(tabByName(page, B)).not.toHaveClass(/--missing/);
    expect(await sceneIds(page)).toEqual(["b-ellipse"]);

    await tabByName(page, A).click();
    const placeholder = page.getByTestId("missing-tab-placeholder");
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toContainText(`${A}.excalidraw`);
    // The tab keeps the mark while it is shown; restoring the file clears it.
    await externalRestore(page, A, PAIR[`${A}.excalidraw`]);
    await expect(tabByName(page, A)).not.toHaveClass(/--missing/, {
      timeout: 5000,
    });
    expect(errors).toEqual([]);
  });

  test("Close tab on the placeholder closes the tab", async ({ page }) => {
    await openSeededVault(page, PAIR);
    await clickTree(page, A);
    await expectShown(page, ["a-rect"]);
    await clickTree(page, B, [MOD]);
    await expectShown(page, ["b-ellipse"]);
    await externalDelete(page, A);
    await expect(tabByName(page, A)).toHaveClass(/--missing/, {
      timeout: 5000,
    });
    await tabByName(page, A).click();
    await page.getByRole("button", { name: "Close tab" }).click();
    await expect(page.getByTestId("missing-tab-placeholder")).toHaveCount(0);
    await expect.poll(() => tabNames(page)).toEqual([B]);
    await expectShown(page, ["b-ellipse"]);
  });

  test("restoring the file while the tab is in the background clears the mark and it opens", async ({
    page,
  }) => {
    await openSeededVault(page, PAIR);
    await clickTree(page, A);
    await expectShown(page, ["a-rect"]);
    await clickTree(page, B, [MOD]);
    await expectShown(page, ["b-ellipse"]);
    await externalDelete(page, A);
    await expect(tabByName(page, A)).toHaveClass(/--missing/, {
      timeout: 5000,
    });
    await externalRestore(page, A, PAIR[`${A}.excalidraw`]);
    await expect(tabByName(page, A)).not.toHaveClass(/--missing/, {
      timeout: 5000,
    });
    await tabByName(page, A).click();
    await expectShown(page, ["a-rect"]);
  });
});

test.describe("new-tab opening from graph, search and links", () => {
  test("Cmd/Ctrl+click on a graph node opens it in a new tab", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openLinksVault(page, "Hub", null, GRAPH_PLUGIN);
    await page.keyboard.press("Meta+Alt+g");
    const graph = page.getByTestId("graph-view");
    await expect(graph).toBeVisible();
    await page.waitForFunction(
      () => (window as any).__graphApp?.metrics.settledMs > 0,
      undefined,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(350);
    const p = await page.evaluate(() => {
      const s = (window as any).__graphApp;
      for (let i = 0; i < s.nodeCount; i++) {
        if (s.pathOf(i) === "Alpha.excalidraw") {
          const r = document
            .querySelector('[data-testid="graph-stage"]')!
            .getBoundingClientRect();
          const at = s.nodeScreen(i);
          return { x: r.left + at.x, y: r.top + at.y };
        }
      }
      throw new Error("no Alpha node");
    });
    await page.mouse.move(p.x - 30, p.y - 30);
    await page.mouse.move(p.x, p.y);
    await page.keyboard.down("Meta");
    await page.mouse.click(p.x, p.y);
    await page.keyboard.up("Meta");
    await expect(graph).toHaveCount(0);
    await expect.poll(() => paths(page)).toEqual(["Hub", "Alpha"]);
    expect(await activeTab(page)).toBe("Alpha");
    expect(errors).toEqual([]);
  });

  test("Cmd/Ctrl+click on a search result opens it in a new tab", async ({
    page,
  }) => {
    await openSeededVault(page, FOUR);
    await clickTree(page, A);
    await expectShown(page, ["a-rect"]);
    await page.getByPlaceholder("Search drawings and text…").fill("Gamma");
    const row = page
      .locator('.vault-search-row[data-kind="drawing"]')
      .filter({ hasText: C });
    await expect(row).toBeVisible();
    await row.click({ modifiers: [MOD] });
    await expectShown(page, ["c-rect"]);
    expect(await tabNames(page)).toEqual([A, C]);
  });

  test("modifier+Shift+click on a [[link]] opens a new tab; history is per tab", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openLinksVault(page, "Hub");
    const crumb = page.locator(".vault-breadcrumbs");
    // Plain modifier click: Hub's tab is replaced by Alpha, with history.
    await cmdClick(page, SEED.alphaText.x, SEED.alphaText.y);
    await expect(crumb).toContainText("Alpha");
    expect(await paths(page)).toEqual(["Alpha"]);

    // Back to Hub in this tab, then modifier+Shift+click: new tab.
    await page.keyboard.press("Meta+Alt+ArrowLeft");
    await expect(crumb).toContainText("Hub");
    const p = await page
      .locator(".vault-editor canvas.interactive")
      .boundingBox();
    const x = p!.x + SEED.alphaText.x;
    const y = p!.y + SEED.alphaText.y;
    await page.keyboard.down("Meta");
    await page.keyboard.down("Shift");
    await page.mouse.move(x, y);
    await page.mouse.click(x, y);
    await page.keyboard.up("Shift");
    await page.keyboard.up("Meta");
    await expect.poll(() => paths(page)).toEqual(["Hub", "Alpha"]);
    await expect(crumb).toContainText("Alpha");
    expect(await activeTab(page)).toBe("Alpha");

    // Tab 2 (Alpha) has its own history: Back there does nothing to tab 1.
    await page.keyboard.press("Meta+Alt+ArrowLeft");
    await expect(crumb).toContainText("Alpha");
    expect(await paths(page)).toEqual(["Hub", "Alpha"]);
    // Tab 1 (Hub) still has Alpha ahead of it: Forward there goes to Alpha.
    await page.getByTestId("vault-tab").first().click();
    await expect(crumb).toContainText("Hub");
    await page.keyboard.press("Meta+Alt+ArrowRight");
    await expect(crumb).toContainText("Alpha");
    expect(errors).toEqual([]);
  });
});

test.describe("layout under the strip", () => {
  test("with the graph open the strip is clickable and the overlay toolbar starts below it", async ({
    page,
  }) => {
    await openLinksVault(page, "Hub", null, GRAPH_PLUGIN);
    await page.keyboard.press("Meta+Alt+g");
    await expect(page.getByTestId("graph-view")).toBeVisible();
    const strip = (await page.getByTestId("vault-tabs").boundingBox())!;
    const bar = (await page.locator(".vd-graph__toolbar").boundingBox())!;
    expect(bar.y).toBeGreaterThanOrEqual(strip.y + strip.height - 0.5);
    // The strip is not covered: a click on "+" hits the button.
    await page.getByTestId("vault-tab-new").click();
    await expect(tabEls(page)).toHaveCount(2);
    await expect(page.getByTestId("graph-view")).toHaveCount(0);
  });

  test("with the gallery open the strip is visible and its header starts below it", async ({
    page,
  }) => {
    await openSeededVault(page, PAIR, "?thumbs=1");
    await clickTree(page, A);
    await expectShown(page, ["a-rect"]);
    await page.keyboard.press(`${MOD}+Alt+KeyE`);
    const gallery = page.getByTestId("gallery-view");
    await expect(gallery).toBeVisible();
    const strip = (await page.getByTestId("vault-tabs").boundingBox())!;
    const head = (await page.locator(".vd-gallery__header").boundingBox())!;
    expect(head.y).toBeGreaterThanOrEqual(strip.y + strip.height - 0.5);
    await tabByName(page, A).click();
    await expect(gallery).toHaveCount(0);
    await expectShown(page, ["a-rect"]);
  });
});
