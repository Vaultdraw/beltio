import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault } from "./helpers";

// Reported bug: in dark mode the black stroke swatch was selected but the
// "Sample text" preview was white. The swatch and the preview must agree, and
// both must show the colour as the dark canvas draws it (light, not black).
test("dark Tools > Text: the selected black swatch and the sample text show the same colour", async ({
  page,
}) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");

  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
  await dialog
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: "Dark" })
    .click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await dialog.getByRole("tab", { name: "Tools", exact: true }).click();
  await dialog
    .getByRole("tablist", { name: "Tools" })
    .getByRole("tab", { name: "Text" })
    .click();
  await dialog
    .getByTestId("tool-default-text")
    .getByRole("radio", { name: /stroke.*#1e1e1e/i })
    .click();

  const swatch = dialog
    .getByTestId("tool-default-text")
    .getByRole("radio", { name: /stroke.*#1e1e1e/i });
  await expect(swatch).toHaveAttribute("aria-checked", "true");
  const sample = dialog.getByText("Sample text");
  await expect(sample).toBeVisible();
  await expect(
    dialog.getByText(/colours are shown as they appear on the dark canvas/),
  ).toBeVisible();

  const swatchColour = await swatch.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  const textColour = await sample.evaluate((el) => getComputedStyle(el).fill);
  expect(textColour).toBe(swatchColour);

  const [r, g, b] = swatchColour.match(/\d+/g)!.map(Number);
  expect(Math.min(r, g, b)).toBeGreaterThan(150); // light, as on the dark canvas
});
