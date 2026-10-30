import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { openVault } from "../helpers";

// Hunter D round 2: user plugins that throw in a panel, on load, with a syntax error, or load
// slowly. The user must see a plain message, the app must stay usable, and the other panels,
// commands and plugins must keep working (Obsidian: a broken community plugin is skipped).
test.use({ allowedErrors: /.*/ });

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });

const start = async (page: Page, plugins: string) => {
  await openVault(page, `?plugins=${plugins}`);
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
};
const runCmd = async (page: Page, query: string) => {
  await page.keyboard.press("Meta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type(query);
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
};

test("a panel that throws shows a message, the app and other panels keep working", async ({
  page,
}) => {
  await start(page, "badpanel,hello");
  await page.getByRole("button", { name: "Bad panel" }).first().click();
  await expect(page.getByRole("alert")).toContainText(/crashed/);
  await page.getByRole("button", { name: "Good panel" }).click();
  await expect(page.getByTestId("good-panel")).toBeVisible();
  // the crashed panel stays a message beside the good one (panels are not exclusive)
  await expect(page.getByRole("alert")).toContainText(/crashed/);
  await expect(page.getByTestId("good-panel")).toBeVisible();
  await runCmd(page, "say hello");
  await expect(page.getByText("Hello from a plugin")).toBeVisible();
});

for (const id of ["badload", "badsyntax"]) {
  test(`a plugin whose load fails (${id}) tells the user and leaves the app usable`, async ({
    page,
  }) => {
    await start(page, `${id},hello`);
    await runCmd(page, `${id === "badload" ? "Bad load" : "Bad syntax"}: run`);
    await page.waitForTimeout(800);
    await expect(
      page.getByText(/failed|error|couldn.t|could not|problem/i).first(),
    ).toBeVisible({ timeout: 3000 });
    await runCmd(page, "say hello");
    await expect(page.getByText("Hello from a plugin")).toBeVisible();
  });
}

test("a slow plugin load does not freeze the app, and its command runs when ready", async ({
  page,
}) => {
  await start(page, "slowload,hello");
  await runCmd(page, "Slow load: run");
  await page.waitForTimeout(300);
  // while it loads, another command still runs
  await runCmd(page, "say hello");
  await expect(page.getByText("Hello from a plugin")).toBeVisible();
  await expect(page.getByText("slow ran")).toBeVisible({ timeout: 8000 });
});
