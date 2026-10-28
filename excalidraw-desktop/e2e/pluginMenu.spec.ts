import { expect, test, type Page } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";
import { seedAndOpen } from "./pageHelpers";

// The menu-demo example (sdk/examples/menu-demo) through the real UI: a right-click
// on a tree row shows the plugin's item (not for folders), choosing it loads the
// plugin and its command reads where it was chosen. The tab and canvas menus show it too.

const mainRequests = (page: Page) => {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (/\/e2e-plugins\/menu-demo\/main\.js/.test(r.url())) {
      urls.push(r.url());
    }
  });
  return urls;
};

test("tree row and tab menus offer the plugin's item and report where it was chosen", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const mains = mainRequests(page);
  await openVault(page, "?plugins=menu-demo");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  expect(mains).toEqual([]);

  // A folder row has no item (kinds = drawing, note).
  await page
    .locator(".vault-tree-item__name", { hasText: /^DSA$/ })
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Reveal in file manager" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Where was I chosen?" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A drawing row has it; choosing it loads the plugin and shows the target.
  await page
    .locator(".vault-tree-item__name", { hasText: /^Start$/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Where was I chosen?" }).click();
  await expect(
    page.getByText("Menu demo: tree: Start.excalidraw"),
  ).toBeVisible();
  expect(mains).toHaveLength(1);

  // The tab menu carries the command's title.
  await page
    .locator("[data-path='Start.excalidraw']")
    .click({ button: "right" });
  await page
    .getByTestId("vault-tab-menu")
    .getByRole("menuitem", { name: "Menu demo: where was I chosen?" })
    .click();
  await expect(
    page.getByText("Menu demo: tab: Start.excalidraw"),
  ).toBeVisible();

  // The canvas menu (a right-click on the drawing) carries it too.
  await page
    .locator("canvas.interactive")
    .click({ button: "right", position: { x: 500, y: 400 } });
  await page
    .locator(".context-menu")
    .getByRole("button", { name: "Menu demo: where was I chosen?" })
    .click();
  await expect(
    page.getByText("Menu demo: canvas: Start.excalidraw"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
