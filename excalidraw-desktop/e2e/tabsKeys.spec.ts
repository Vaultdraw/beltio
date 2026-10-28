import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { AFTER_AUTOSAVE_MS } from "./constants";
import {
  A,
  B,
  PAIR,
  activeTab,
  clickTree,
  drawRectangle,
  expectShown,
  mounted,
  openSeededVault,
  readTabs,
  sceneIds,
  sceneJson,
  tabByName,
  tabEls,
  tabNames,
  trackErrors,
  treeName,
} from "./tabsHelpers";

// Keyboard, palette and behaviour cases for tabs. The single visible-UI test
// is tabs.spec.ts.
const C = "Gamma";
const TRIO = {
  ...PAIR,
  [`${C}.excalidraw`]: sceneJson([{ id: "c-rect", x: 200, y: 120 }]),
};
const MOD = "Meta";
// The harness emulates Safari on macOS on every host, so the mac chords apply.
const NEXT = `${MOD}+Shift+BracketRight`;
const PREV = `${MOD}+Shift+BracketLeft`;

/** Opens A, B, C each in its own tab (Cmd+click), C active. */
const openTrio = async (page: Page) => {
  await openSeededVault(page, TRIO);
  await clickTree(page, A);
  await expectShown(page, ["a-rect"]);
  await clickTree(page, B, [MOD]);
  await expectShown(page, ["b-ellipse"]);
  await clickTree(page, C, [MOD]);
  await expectShown(page, ["c-rect"]);
  expect(await tabNames(page)).toEqual([A, B, C]);
};

const shownAfter = (page: Page, name: string, ids: string[]) =>
  expect
    .poll(
      async () => ({
        active: await activeTab(page),
        ids: await sceneIds(page),
      }),
      {
        timeout: 8000,
      },
    )
    .toEqual({ active: name, ids });

test.describe("opening", () => {
  test("Cmd+click opens a new tab, one tab per file, plain click replaces", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openSeededVault(page, TRIO);
    // Home tab: the first click opens in it.
    expect(await tabNames(page)).toHaveLength(1);
    await clickTree(page, A);
    await expectShown(page, ["a-rect"]);
    expect(await tabNames(page)).toEqual([A]);

    await clickTree(page, B, [MOD]);
    await expectShown(page, ["b-ellipse"]);
    expect(await tabNames(page)).toEqual([A, B]);
    expect(await activeTab(page)).toBe(B);

    // One tab per file: opening an open file focuses its tab.
    await clickTree(page, A, [MOD]);
    await expectShown(page, ["a-rect"]);
    expect(await tabNames(page)).toEqual([A, B]);
    expect(await activeTab(page)).toBe(A);
    await clickTree(page, B);
    await expectShown(page, ["b-ellipse"]);
    expect(await tabNames(page)).toEqual([A, B]);
    expect(await activeTab(page)).toBe(B);

    // Plain click replaces the current tab.
    await clickTree(page, C);
    await expectShown(page, ["c-rect"]);
    expect(await tabNames(page)).toEqual([A, C]);
    expect(await activeTab(page)).toBe(C);
    expect(errors).toEqual([]);
  });

  test("Mod+T opens a home tab; the strip + button matches", async ({
    page,
  }) => {
    await openSeededVault(page, TRIO);
    await clickTree(page, A);
    await expectShown(page, ["a-rect"]);
    await page.keyboard.press(`${MOD}+KeyT`);
    await expect(tabEls(page)).toHaveCount(2);
    expect((await readTabs(page))[1]).toMatchObject({ active: true, path: "" });
    expect(await mounted(page)).toBe(0);
    await clickTree(page, B);
    await expectShown(page, ["b-ellipse"]);
    expect(await tabNames(page)).toEqual([A, B]);
  });
});

test.describe("closing", () => {
  test("Mod+W closes the active tab and activates the most recent one", async ({
    page,
  }) => {
    await openTrio(page);
    await tabByName(page, A).click(); // MRU: A, C, B
    await shownAfter(page, A, ["a-rect"]);
    await page.keyboard.press(`${MOD}+KeyW`);
    // MRU previous (C), not the right neighbour (B).
    await shownAfter(page, C, ["c-rect"]);
    expect(await tabNames(page)).toEqual([B, C]);
  });

  test("closing the last tab leaves a home tab", async ({ page }) => {
    await openSeededVault(page, TRIO);
    await clickTree(page, A);
    await expectShown(page, ["a-rect"]);
    await page.keyboard.press(`${MOD}+KeyW`);
    await expect(tabEls(page)).toHaveCount(1);
    expect((await readTabs(page))[0]).toMatchObject({ active: true, path: "" });
    await expect(page.getByText("No drawing open")).toBeVisible();
    expect(await mounted(page)).toBe(0);
  });

  test("Mod+Shift+T reopens the closed tab at its old index", async ({
    page,
  }) => {
    await openTrio(page);
    await tabByName(page, B).click({ button: "middle" });
    await expect(tabEls(page)).toHaveCount(2);
    expect(await tabNames(page)).toEqual([A, C]);
    await page.keyboard.press(`${MOD}+Shift+KeyT`);
    await expect(tabEls(page)).toHaveCount(3);
    expect(await tabNames(page)).toEqual([A, B, C]);
    await shownAfter(page, B, ["b-ellipse"]);
  });

  test("middle click and the close button close a tab", async ({ page }) => {
    await openTrio(page);
    await tabByName(page, A).click({ button: "middle" });
    await expect(tabEls(page)).toHaveCount(2);
    expect(await tabNames(page)).toEqual([B, C]);
    await tabByName(page, B).hover();
    await tabByName(page, B).getByTestId("vault-tab-close").click();
    expect(await tabNames(page)).toEqual([C]);
    await shownAfter(page, C, ["c-rect"]);
  });
});

test.describe("switching", () => {
  test("Mod+1, Mod+9, next / previous wrap, Ctrl+Tab toggles the last two", async ({
    page,
  }) => {
    await openTrio(page);
    await page.keyboard.press(`${MOD}+Digit1`);
    await shownAfter(page, A, ["a-rect"]);
    await page.keyboard.press(`${MOD}+Digit9`);
    await shownAfter(page, C, ["c-rect"]);
    await page.keyboard.press(NEXT); // wraps to the first
    await shownAfter(page, A, ["a-rect"]);
    await page.keyboard.press(PREV); // wraps to the last
    await shownAfter(page, C, ["c-rect"]);
    await page.keyboard.press(PREV);
    await shownAfter(page, B, ["b-ellipse"]);

    // MRU now: B, C, A. Ctrl+Tab goes to C, again back to B.
    await page.keyboard.press("Control+Tab");
    await shownAfter(page, C, ["c-rect"]);
    await page.keyboard.press("Control+Tab");
    await shownAfter(page, B, ["b-ellipse"]);
  });

  test("tab strip keyboard: ArrowRight moves focus, Enter activates", async ({
    page,
  }) => {
    await openTrio(page);
    await tabByName(page, A).click();
    await shownAfter(page, A, ["a-rect"]);
    await tabByName(page, A).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabByName(page, B)).toBeFocused();
    // Manual activation: focus alone does not switch.
    expect(await activeTab(page)).toBe(A);
    await page.keyboard.press("Enter");
    await shownAfter(page, B, ["b-ellipse"]);
  });
});

test.describe("undo across switches", () => {
  test("draw in A, switch to B and back, Mod+Z removes the rectangle", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openSeededVault(page, PAIR);
    await clickTree(page, A);
    await expectShown(page, ["a-rect"]);
    await drawRectangle(page);
    await expect.poll(async () => (await sceneIds(page)).length).toBe(2);
    await page.waitForTimeout(AFTER_AUTOSAVE_MS);

    await clickTree(page, B, [MOD]);
    await expectShown(page, ["b-ellipse"]);
    await tabByName(page, A).click();
    await expect.poll(async () => (await sceneIds(page)).length).toBe(2);

    await page.keyboard.press(`${MOD}+KeyZ`);
    await expectShown(page, ["a-rect"]);
    expect(errors).toEqual([]);
  });

  test("undo is not restored when the file changed in between", async ({
    page,
  }) => {
    await openSeededVault(page, PAIR);
    await clickTree(page, A);
    await expectShown(page, ["a-rect"]);
    await drawRectangle(page);
    await expect.poll(async () => (await sceneIds(page)).length).toBe(2);
    await page.waitForTimeout(AFTER_AUTOSAVE_MS);

    await clickTree(page, B, [MOD]);
    await expectShown(page, ["b-ellipse"]);
    // Another program rewrites A while it is a background tab.
    await page.evaluate(
      ([path, json]) => (window as any).__vaultRepo.externalWrite(path, json),
      [
        `${A}.excalidraw`,
        sceneJson([
          { id: "a-rect" },
          { id: "a-outside", x: 420, y: 300, w: 60, h: 60 },
        ]),
      ],
    );
    await tabByName(page, A).click();
    await expectShown(page, ["a-rect", "a-outside"]);
    await page.keyboard.press(`${MOD}+KeyZ`);
    await page.waitForTimeout(300);
    expect(await sceneIds(page)).toEqual(["a-rect", "a-outside"]);
  });
});

test.describe("rename and trash of an open background drawing", () => {
  const rowAction = async (page: Page, name: string, label: string) => {
    const row = page
      .locator(".vault-tree-item")
      .filter({ has: treeName(page, name) })
      .first();
    await row.hover();
    await row.getByRole("button", { name: "More actions" }).click();
    return page.getByRole("menuitem", { name: label, exact: true });
  };

  test("rename updates the tab name and it still opens", async ({ page }) => {
    await openSeededVault(page, PAIR);
    await clickTree(page, A);
    await expectShown(page, ["a-rect"]);
    await clickTree(page, B, [MOD]);
    await expectShown(page, ["b-ellipse"]);

    await (await rowAction(page, A, "Rename…")).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("New name").fill("Alpha Two");
    await dialog.getByRole("button", { name: "Rename" }).click();
    await expect(dialog).toHaveCount(0);

    await expect.poll(() => tabNames(page)).toEqual(["Alpha Two", B]);
    expect((await readTabs(page))[0].path).toBe("Alpha Two.excalidraw");
    await tabByName(page, "Alpha Two").click();
    await shownAfter(page, "Alpha Two", ["a-rect"]);
  });

  test("trash removes the tab", async ({ page }) => {
    await openSeededVault(page, PAIR);
    await clickTree(page, A);
    await expectShown(page, ["a-rect"]);
    await clickTree(page, B, [MOD]);
    await expectShown(page, ["b-ellipse"]);

    await (await rowAction(page, A, "Move to Trash")).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Move to Trash" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => tabNames(page)).toEqual([B]);
    expect(await sceneIds(page)).toEqual(["b-ellipse"]);
  });
});

test.describe("session and settings", () => {
  test("session restore: same tabs, same active tab, only the active one is read", async ({
    page,
  }) => {
    // Log every drawing read the app makes in the fresh in-memory vault after a reload.
    await page.addInitScript(() => {
      const w = window as any;
      w.__reads = [] as string[];
      let repo: any;
      Object.defineProperty(w, "__vaultRepo", {
        configurable: true,
        get: () => repo,
        set: (r) => {
          repo = r;
          const read = r.readDrawing.bind(r);
          r.readDrawing = (h: string, p: string) => {
            // The fake tag index also reads every drawing; count the app's own reads.
            if (new Error().stack?.includes("VaultApp")) {
              w.__reads.push(p);
            }
            return read(h, p);
          };
        },
      });
    });
    await openSeededVault(page);
    const G = "Graphs";
    const I = "01 Introduction";
    await page.locator(".vault-tree-item", { hasText: "DSA" }).first().click();
    await expect(treeName(page, G)).toBeVisible();
    await clickTree(page, G);
    await expectShown(page, ["rect-1", "text-1", "arrow-1"].filter(Boolean));
    await page
      .locator(".vault-tree-item", { hasText: "Dynamic Programming" })
      .first()
      .click();
    await clickTree(page, I, [MOD]);
    await expect(tabEls(page)).toHaveCount(2);
    await page.getByTestId("vault-tab-new").click();
    await expect(tabEls(page)).toHaveCount(3);
    await tabByName(page, G).click();
    await expect.poll(() => activeTab(page)).toBe(G);
    const before = await readTabs(page);
    expect(before.map((t) => t.name)).toEqual([G, I, "New tab"]);
    // The session is written 1 s after the last change.
    await page.waitForTimeout(1600);

    await page.goto("/e2e.html");
    await expect(page.getByLabel("Vault file navigator")).toBeVisible();
    await expect(tabEls(page)).toHaveCount(3);
    const after = await readTabs(page);
    expect(after.map((t) => t.name)).toEqual(before.map((t) => t.name));
    expect(after.map((t) => t.active)).toEqual(before.map((t) => t.active));
    await expect(
      page.locator(".vault-editor canvas.interactive"),
    ).toBeVisible();
    // Only the active tab's file is loaded.
    const reads = await page.evaluate(
      () => (window as any).__reads as string[],
    );
    expect(reads.filter((p) => p.endsWith(".excalidraw"))).toEqual([
      "DSA/Graphs.excalidraw",
    ]);
  });

  test("tabsEnabled=false shows no strip", async ({ page }) => {
    // Set before boot (the harness has no settings UI hook that re-renders the app).
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "excalidraw-vault-preferences-v1",
        JSON.stringify({ tabsEnabled: false }),
      );
    });
    await openSeededVault(page, PAIR);
    await expect(page.getByTestId("vault-tabs")).toHaveCount(0);
    await clickTree(page, A);
    await expectShown(page, ["a-rect"]);
    await expect(page.getByTestId("vault-tabs")).toHaveCount(0);
  });
});
