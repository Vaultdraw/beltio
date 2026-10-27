import { expect, test, type Page } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";
import { seedAndOpen } from "./pageHelpers";

// The toolbar-demo example (sdk/examples/toolbar-demo) through the real UI: the button
// shows over the canvas without loading the plugin; a click loads it and runs its command.

const mainRequests = (page: Page) => {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (/\/e2e-plugins\/toolbar-demo\/main\.js/.test(r.url())) {
      urls.push(r.url());
    }
  });
  return urls;
};

test("a plugin toolbar button shows over the canvas and runs its command on click", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const mains = mainRequests(page);
  await openVault(page, "?plugins=toolbar-demo");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  const button = page.getByRole("button", { name: "Count clicks" });
  await expect(button).toBeVisible();
  expect(mains).toEqual([]);

  await button.click();
  await expect(
    page.getByText("Toolbar demo: Clicked 1 time", { exact: true }),
  ).toBeVisible();
  expect(mains.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
