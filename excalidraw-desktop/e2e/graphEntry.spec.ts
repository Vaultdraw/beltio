import { mkdirSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { expectOpen, GRAPH_PLUGIN, openLinksVault } from "./linksHelpers";
import { personalPath } from "./mainCheckout";

// Graph view UI entry points (toimprove #22): navigator button, main menu and
// a drawing's row menu. Each one dispatches the existing graph commands.
const SHOTS =
  process.env.GRAPH_SHOTS_DIR ??
  personalPath("feature/graph-ui-entry/screenshots");

type Session = {
  nodeCount: number;
  isLocal: boolean;
  metrics: { settledMs: number };
  pathOf(i: number): string | null;
};
const session = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __graphApp?: Session | null }).__graphApp;
    if (!s) {
      return null;
    }
    const paths: (string | null)[] = [];
    for (let i = 0; i < s.nodeCount; i++) {
      paths.push(s.pathOf(i));
    }
    return { isLocal: s.isLocal, paths };
  });

const graph = (page: Page) => page.getByTestId("graph-view");
const navigator = (page: Page) => page.getByLabel("Vault file navigator");
// The activity bar (on by default) owns the Graph entry; the navigator toolbar
// button is not rendered while it is on.
const graphButton = (page: Page) => page.getByTestId("activity-bar-graph");

const expectGraph = async (page: Page) => {
  await expect(graph(page)).toBeVisible();
  await page.waitForFunction(
    () => ((window as any).__graphApp?.metrics.settledMs ?? 0) > 0,
    undefined,
    { timeout: 20_000 },
  );
};

const expectClosedOn = async (page: Page, name: string) => {
  await expect(graph(page)).toHaveCount(0);
  await expectOpen(page, name);
  await expect(page.locator(".vault-editor-container")).toBeVisible();
};

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test("activity bar button opens the graph, shows its key, toggles; Esc returns", async ({
  page,
}) => {
  await openLinksVault(page, "Hub", null, GRAPH_PLUGIN);
  await expect(
    navigator(page).getByRole("button", { name: "Graph view", exact: true }),
  ).toHaveCount(0);
  await expect(graphButton(page)).toHaveAttribute(
    "title",
    /^Graph view \((Cmd\+Option\+G|Ctrl\+Alt\+G)\)$/,
  );
  await expect(graphButton(page)).toHaveAttribute("aria-pressed", "false");
  await navigator(page)
    .locator(".vault-navigator__toolbar")
    .screenshot({ path: `${SHOTS}/navigator-toolbar.png` });

  await graphButton(page).click();
  await expectGraph(page);
  expect((await session(page))?.isLocal).toBe(false);
  await expect(graphButton(page)).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: `${SHOTS}/graph-from-button.png` });
  await page.keyboard.press("Escape");
  await expectClosedOn(page, "Hub");

  // A second click while it is open closes it (graph.open toggles).
  await graphButton(page).click();
  await expectGraph(page);
  await graphButton(page).click();
  await expectClosedOn(page, "Hub");
});

test("main menu Graph view shows the key and opens the graph; Esc returns", async ({
  page,
}) => {
  await openLinksVault(page, "Hub", null, GRAPH_PLUGIN);
  await page.getByTestId("main-menu-trigger").click();
  const item = page.getByRole("menuitem", { name: /Graph view/ });
  await expect(item).toContainText(/(Cmd\+Option\+G|Ctrl\+Alt\+G)/);
  await page.screenshot({ path: `${SHOTS}/main-menu.png` });
  await item.click();
  await expectGraph(page);
  expect((await session(page))?.isLocal).toBe(false);
  await page.keyboard.press("Escape");
  await expectClosedOn(page, "Hub");
});

test("row menu Open local graph opens that drawing's local graph; Esc returns", async ({
  page,
}) => {
  await openLinksVault(page, "Hub", null, GRAPH_PLUGIN);
  const row = navigator(page)
    .locator(".vault-tree-item__name", { hasText: /^Alpha$/ })
    .first();
  await row.click({ button: "right" });
  const menuItem = page.getByRole("menuitem", { name: "Open local graph" });
  await expect(menuItem).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/row-menu.png` });
  await menuItem.click();
  await expectGraph(page);
  await expectOpen(page, "Alpha");
  const s = await session(page);
  expect(s?.isLocal).toBe(true);
  expect(s?.paths).toContain("Alpha.excalidraw");
  await page.screenshot({ path: `${SHOTS}/local-graph-from-row.png` });
  await page.keyboard.press("Escape");
  await expectClosedOn(page, "Alpha");

  // On the active drawing it opens straight away.
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open local graph" }).click();
  await expectGraph(page);
  expect((await session(page))?.isLocal).toBe(true);
  await page.keyboard.press("Escape");
  await expectClosedOn(page, "Alpha");
});
