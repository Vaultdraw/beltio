import { mkdirSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import {
  breadcrumbs,
  expectOpen,
  GRAPH_PLUGIN,
  openLinksVault,
} from "./linksHelpers";
import { personalPath } from "./mainCheckout";

// The graph inside the real VaultApp (fake links, fake vault_graph, fake settings.toml; no Rust).
const SHOTS =
  process.env.GRAPH_SHOTS_DIR ??
  personalPath("feature/links-graph/screenshots/p3");

type Win = Window & {
  __graphApp?: {
    nodeCount: number;
    isLocal: boolean;
    metrics: { settledMs: number; frames: number };
    nodeScreen(i: number): { x: number; y: number };
    pathOf(i: number): string | null;
    labelWorstStep(): number;
    resetLabelStats(): void;
  } | null;
  __graphSettingsToml: Record<string, unknown>;
};

const graph = (page: Page) => page.getByTestId("graph-view");
const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });

const openGraph = async (page: Page, keys = "Meta+Alt+g") => {
  await page.keyboard.press(keys);
  await expect(graph(page)).toBeVisible();
  await page.waitForFunction(
    () => (window as unknown as Win).__graphApp?.metrics.settledMs! > 0,
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(350); // fit tween
};

/** Page position of a drawing's node. */
const nodeAt = (page: Page, path: string) =>
  page.evaluate((p) => {
    const s = (window as unknown as Win).__graphApp!;
    for (let i = 0; i < s.nodeCount; i++) {
      if (s.pathOf(i) === p) {
        const r = document
          .querySelector('[data-testid="graph-stage"]')!
          .getBoundingClientRect();
        const at = s.nodeScreen(i);
        return { x: r.left + at.x, y: r.top + at.y };
      }
    }
    throw new Error(`no node ${p}`);
  }, path);

const hover = async (page: Page, path: string) => {
  const p = await nodeAt(page, path);
  await page.mouse.move(p.x - 30, p.y - 30);
  await page.mouse.move(p.x, p.y);
  return p;
};

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test("Mod+Alt+G opens the graph over the canvas, hover shows name and shortcut row, Esc returns", async ({
  page,
}) => {
  await openLinksVault(page, "Hub", null, GRAPH_PLUGIN);
  const canvas = page.locator(".vault-editor canvas.interactive");
  const before = await canvas.screenshot();
  await openGraph(page);
  await expect(page.getByLabel("Vault file navigator")).toBeVisible();
  // The editor is hidden and inert while the graph is open.
  await expect(page.locator(".vault-editor-container")).toBeHidden();
  expect(
    await page
      .locator(".vault-editor-container")
      .evaluate((el) => el.hasAttribute("inert")),
  ).toBe(true);
  await hover(page, "Alpha.excalidraw");
  const card = page.getByTestId("graph-card");
  await expect(card).toContainText("Alpha");
  await expect(card).toContainText("↵ open");
  await page.keyboard.press("Escape");
  await expect(graph(page)).toHaveCount(0);
  await expectOpen(page, "Hub");
  await expect(page.locator(".vault-editor-container")).toBeVisible();
  expect(Buffer.compare(await canvas.screenshot(), before)).toBe(0);
});

test("Enter opens the hovered drawing and closes the graph; click does too", async ({
  page,
}) => {
  await openLinksVault(page, "Hub", null, GRAPH_PLUGIN);
  await openGraph(page);
  await hover(page, "Alpha.excalidraw");
  await page.keyboard.press("Enter");
  await expect(graph(page)).toHaveCount(0);
  await expectOpen(page, "Alpha");

  await openGraph(page);
  const p = await hover(page, "Hub.excalidraw");
  await page.mouse.click(p.x, p.y);
  await expect(graph(page)).toHaveCount(0);
  await expectOpen(page, "Hub");
  await expect(breadcrumbs(page)).not.toContainText("Alpha");
});

test("Mod+Alt+O opens the local graph around the current drawing", async ({
  page,
}) => {
  await openLinksVault(page, "Hub", null, GRAPH_PLUGIN);
  await openGraph(page);
  const all = await page.evaluate(
    () => (window as unknown as Win).__graphApp!.nodeCount,
  );
  await page.keyboard.press("Escape");
  await expect(graph(page)).toHaveCount(0);
  await openGraph(page, "Meta+Alt+o");
  const local = await page.evaluate(() => {
    const s = (window as unknown as Win).__graphApp!;
    return { n: s.nodeCount, local: s.isLocal };
  });
  expect(local.local).toBe(true);
  expect(local.n).toBeGreaterThan(1);
  expect(local.n).toBeLessThan(all);
});

test("Graph commands are in Cmd+Shift+P and on the Hotkeys page", async ({
  page,
}) => {
  await openLinksVault(page, "Hub", null, GRAPH_PLUGIN);
  await page.keyboard.press("Meta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await palette(page).getByRole("combobox").fill(">graph");
  const options = palette(page).getByRole("option");
  await expect(options.filter({ hasText: "Open graph view" })).toBeVisible();
  await expect(options.filter({ hasText: "Open local graph" })).toBeVisible();
  await expect(options.filter({ hasText: "Fit graph to view" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+Comma");
  await page.getByRole("tab", { name: "Hotkeys" }).click();
  for (const id of ["graph.open", "graph.openLocal", "graph.fit"]) {
    await expect(
      page.locator(`.vault-hotkeys__row[data-command-id="${id}"]`),
    ).toBeVisible();
  }
});

test("graph.fit refits through the palette without a synthetic key", async ({
  page,
}) => {
  await openLinksVault(page, "Hub", null, GRAPH_PLUGIN);
  await openGraph(page);
  const scale = () =>
    page.evaluate(() => (window as unknown as Win).__graphApp!.nodeCount);
  await scale();
  await page.evaluate(() => (window as any).__graphApp.zoomCentre(3));
  await page.waitForTimeout(300);
  const s0 = await page.evaluate(
    () => (window as any).__graphApp.scale as number,
  );
  await page.keyboard.press("Meta+Shift+KeyP");
  await palette(page).getByRole("combobox").fill(">fit graph");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const s1 = await page.evaluate(
    () => (window as any).__graphApp.scale as number,
  );
  expect(s1).not.toBe(s0);
});

test("theme change recolours the graph (light and dark screenshots)", async ({
  page,
}) => {
  await openLinksVault(page, "Hub", null, GRAPH_PLUGIN);
  await openGraph(page);
  await hover(page, "Alpha.excalidraw");
  await page.waitForTimeout(250);
  const stage = page.getByTestId("graph-stage");
  const light = await stage.screenshot({ path: `${SHOTS}/app-light.png` });
  // Dracula follows the system scheme: dark mode gives its dark variant.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.keyboard.press("Meta+Comma");
  const dialog = page.locator(".vault-settings-modal");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: "Dracula" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(graph(page)).toBeVisible();
  await page.waitForTimeout(500);
  const dark = await stage.screenshot({ path: `${SHOTS}/app-dracula.png` });
  expect(Buffer.compare(light, dark)).not.toBe(0);
  const bg = (b: Buffer) => b.subarray(b.length >> 1, (b.length >> 1) + 64);
  expect(Buffer.compare(bg(light), bg(dark))).not.toBe(0);
});

test("per-vault graph settings persist to settings.toml across a reload", async ({
  page,
}) => {
  await openLinksVault(page, "Hub", null, GRAPH_PLUGIN);
  await openGraph(page);
  await graph(page).getByRole("button", { name: "Settings" }).click();
  await page.keyboard.press("Escape");
  // Toggle orphans through the palette command (same path as the toolbar).
  await page.keyboard.press("Meta+Shift+KeyP");
  await palette(page).getByRole("combobox").fill(">toggle orphans");
  await page.keyboard.press("Enter");
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as Win).__graphSettingsToml[
              "graph.show_orphans"
            ],
        ),
      { timeout: 5000 },
    )
    .toBe(false);
  await page.reload();
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await expect(page.getByLabel("Vault file navigator")).toBeVisible();
  await page
    .locator(".vault-tree-item__name", { hasText: "Hub" })
    .first()
    .click();
  await page.waitForTimeout(500);
  const toml = await page.evaluate(
    () => (window as unknown as Win).__graphSettingsToml,
  );
  expect(toml["graph.show_orphans"]).toBe(false);
  await openGraph(page);
  const orphanless = await page.evaluate(
    () => (window as unknown as Win).__graphApp!.nodeCount,
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+Shift+KeyP");
  await palette(page).getByRole("combobox").fill(">toggle orphans");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  const withOrphans = await page.evaluate(
    () => (window as unknown as Win).__graphApp!.nodeCount,
  );
  expect(withOrphans).toBeGreaterThanOrEqual(orphanless);
});

test("labels fade smoothly while the graph moves: no label pops in or out", async ({
  page,
}) => {
  await openLinksVault(page, "Hub", null, GRAPH_PLUGIN);
  await openGraph(page);
  await page.evaluate(() =>
    (window as unknown as Win).__graphApp!.resetLabelStats(),
  );
  // Move things: drag a node around (the layout reheats and its neighbours follow), then zoom.
  const p = await nodeAt(page, "Hub.excalidraw");
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(p.x + 4 * i, p.y + 2 * i);
  }
  await page.mouse.up();
  await page.mouse.move(p.x, p.y);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, i % 2 === 0 ? -120 : 120);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(600);
  const worst = await page.evaluate(() =>
    (window as unknown as Win).__graphApp!.labelWorstStep(),
  );
  // 1 = the fastest the fade allows; a label that popped would read far above it.
  expect(worst).toBeLessThanOrEqual(1.001);
});
