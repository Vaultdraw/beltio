import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { canvasBox, openDrawing, openVault, trackErrors } from "./helpers";

/** Is the toolbar's `name` tool the active one (input, class or aria). */
const toolActive = (page: Page, name: string) =>
  page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(
      `.vault-editor [data-testid='toolbar-${id}']`,
    );
    if (!el) {
      return null;
    }
    const input =
      el instanceof HTMLInputElement ? el : el.querySelector("input");
    if (input) {
      return input.checked;
    }
    return (
      el.classList.contains("selected") ||
      el.classList.contains("is-selected") ||
      el.getAttribute("aria-checked") === "true" ||
      el.getAttribute("data-state") === "on" ||
      el.getAttribute("aria-pressed") === "true"
    );
  }, name);

test("a recorded key sequence shows the which-key popup and picks a tool", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");

  // Bind "g r" to Tool: Rectangle through Settings, with clicks only.
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const modal = page.locator(".vault-settings-modal");
  await expect(modal).toBeVisible();
  await page.getByRole("tab", { name: "Hotkeys" }).click();
  await page.getByLabel("Filter hotkeys").fill("Rectangle");
  await page
    .getByRole("button", { name: "Add hotkey for Tool: Rectangle" })
    .click();
  await page.getByRole("button", { name: "Sequence", exact: true }).click();
  await page.keyboard.type("g");
  await page.keyboard.type("r");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(modal).toHaveCount(0);

  // Make Rectangle inactive so the final assertion means something.
  await page.locator(".vault-editor [data-testid='toolbar-diamond']").click();
  await expect.poll(() => toolActive(page, "diamond")).toBe(true);
  expect(await toolActive(page, "rectangle")).toBe(false);

  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8);
  await page.keyboard.press("g");

  // One assertion, not two: the pending sequence expires after keys.timeout_ms
  // (1 s), which a slow (emulated) machine can pass between two checks.
  const popup = page.getByRole("status", { name: "Key sequence options" });
  await expect(popup.filter({ hasText: "Rectangle" })).toBeVisible();

  await page.keyboard.press("r");
  await expect(popup).toHaveCount(0);
  await expect.poll(() => toolActive(page, "rectangle")).toBe(true);
  expect(errors).toEqual([]);
});

test("Settings names a key group from the Hotkeys page", async ({ page }) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(page.locator(".vault-settings-modal")).toBeVisible();
  await page.getByRole("tab", { name: "Hotkeys" }).click();

  const labels = page.getByTestId("key-labels");
  await labels.getByLabel("Key sequence", { exact: true }).fill("Nope+x");
  await labels.getByLabel("Name of the group", { exact: true }).fill("bad");
  await labels.getByRole("button", { name: "Add name" }).click();
  await expect(labels.getByText("Not a key sequence")).toBeVisible();

  await labels.getByLabel("Key sequence", { exact: true }).fill("<leader> f");
  await labels.getByLabel("Name of the group", { exact: true }).fill("file");
  await labels.getByRole("button", { name: "Add name" }).click();
  await expect(
    labels.getByLabel("Name for <leader> f", { exact: true }),
  ).toHaveValue("file");

  await labels
    .getByRole("button", { name: "Remove name for <leader> f" })
    .click();
  await expect(
    labels.getByLabel("Name for <leader> f", { exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
