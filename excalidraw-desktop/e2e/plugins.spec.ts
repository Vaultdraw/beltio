import { expect, test, type Page } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";

// Plugin host through the real UI: fixture plugins (e2e/fixtures/plugins) are
// served as real ES modules and import react / @vaultdraw/api via the import map.

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });
const options = (page: Page) => palette(page).getByRole("option");

const openVaultWithPlugins = async (page: Page, plugins: string) => {
  await openVault(page, `?plugins=${plugins}`);
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
};

const openCommands = async (page: Page, query: string) => {
  await page.keyboard.press("ControlOrMeta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type(query);
};

const loadMarks = (page: Page, id: string) =>
  page.evaluate(
    (n) => performance.getEntriesByName(`vaultdraw:plugin:${n}:load`).length,
    id,
  );

const moduleRequests = (page: Page) => {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/e2e-plugins/")) {
      urls.push(r.url());
    }
  });
  return urls;
};

test("a plugin command is in the palette, loads lazily and runs", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const requests = moduleRequests(page);
  await openVaultWithPlugins(page, "hello");
  expect(await loadMarks(page, "hello")).toBe(0);
  expect(requests).toEqual([]);

  await openCommands(page, "say hello");
  await expect(options(page).first()).toContainText("Hello: say hello");
  expect(await loadMarks(page, "hello")).toBe(0);
  await page.keyboard.press("Enter");

  await expect(page.getByText("Hello from a plugin")).toBeVisible();
  expect(await loadMarks(page, "hello")).toBe(1);
  expect(requests).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("a plugin panel shares the host React (hooks work)", async ({ page }) => {
  const errors = trackErrors(page);
  await openVaultWithPlugins(page, "counter");
  await page.getByRole("button", { name: "Counter" }).click();

  const count = page.getByTestId("count");
  await expect(count).toHaveText("Count: 0");
  const increment = page.getByRole("button", { name: "Increment" });
  await increment.click();
  await increment.click();
  await expect(count).toHaveText("Count: 2");
  expect(errors.filter((e) => /Invalid hook call/i.test(e))).toEqual([]);
  expect(errors).toEqual([]);
});

test("a plugin that fails three times is disabled and leaves the palette", async ({
  page,
}) => {
  await openVaultWithPlugins(page, "crashy");
  for (let run = 0; run < 3; run++) {
    await openCommands(page, "explode");
    await expect(options(page).first()).toContainText("Crashy: explode");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toHaveCount(0);
    // Let the failing handler run before the next attempt.
    await page.waitForFunction(
      (n) =>
        ((window as any).__plugins.getPluginCosts() as any[]).find(
          (c) => c.id === "crashy",
        )?.handlerMs.length >= n,
      run + 1,
    );
  }
  await expect(
    page.getByText(/Plugin Crashy was disabled: 3 errors/),
  ).toBeVisible();

  await openCommands(page, "explode");
  await expect(options(page).filter({ hasText: "Crashy" })).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("with no plugins nothing plugin-related is in the DOM or fetched", async ({
  page,
}) => {
  const requests = moduleRequests(page);
  await openVault(page);
  await page.waitForTimeout(500);
  expect(requests).toEqual([]);
  expect(await page.locator("[class*='plugin']").count()).toBe(0);
  expect(await loadMarks(page, "hello")).toBe(0);
  expect(await page.evaluate(() => "__plugins" in window)).toBe(false);
  await openCommands(page, "hello");
  await expect(options(page).filter({ hasText: "Hello" })).toHaveCount(0);
});
