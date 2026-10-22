import { expect, test } from "@playwright/test";

import { openDrawing, openVault, trackErrors } from "./helpers";

// event-logger through the real UI: it activates at startup, subscribes to the
// app events and lists them newest first in its "Event log" panel.

test("event-logger: panel lists opened drawings newest first, Clear empties it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=event-logger");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);

  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");

  await page.getByRole("button", { name: "Event log" }).click();
  const items = page.getByTestId("event-log-list").getByRole("listitem");
  await expect(items.first()).toContainText(/drawing\.opened\s+DSA\/Graphs/);

  const before = await items.count();
  await page
    .locator(".vault-tree-item__name", { hasText: "Dynamic Programming" })
    .first()
    .click();
  await openDrawing(page, "Introduction");
  await expect(items).toHaveCount(before + 1);
  await expect(items.first()).toContainText(
    /drawing\.opened\s+DSA\/Dynamic Programming\/01 Introduction/,
  );

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByTestId("event-log-empty")).toBeVisible();
  await expect(items).toHaveCount(0);
  expect(errors).toEqual([]);
});
