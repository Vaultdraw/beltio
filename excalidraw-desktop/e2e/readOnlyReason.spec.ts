import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

// toimprove #40: the Read-Only badge explains itself and offers a way out.
// The one visible-UI test: every step is a click, every check is on screen.
test("read-only badge: shows why, then Try again makes the vault writable", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?readonly=1&locked=1");
  const badge = page.getByRole("button", { name: /Read-Only/ });
  await expect(badge).toBeVisible();

  await badge.click();
  const panel = page.getByRole("dialog", {
    name: "Why this vault is read-only",
  });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Open in another Vaultdraw");
  await expect(panel).toContainText("process 4242");

  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(badge).toBeHidden();
  await expect(page.getByText("E2E Vault is writable again")).toBeVisible();
  // Writable again: the navigator offers "New drawing" once more.
  await expect(
    page.getByRole("button", { name: /New drawing/ }).first(),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});
