import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

// `[include]` in config.toml: the Config files list shows each included file with its
// status, and a value that comes from one says so on its chip.
test("Config files lists an included file and a setting's chip names it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    (window as any).__e2eConfig = { include: { files: ["colors.toml"] } };
    (window as any).__e2eIncludes = [
      {
        name: "colors.toml",
        path: "/e2e/dots/colors.toml",
        config: { interface: { thumbnails: false } },
      },
      { name: "gone.toml", path: "/e2e/dots/gone.toml", config: null },
    ];
  });
  await openVault(page, "?config=1");

  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");

  await dialog.getByRole("tab", { name: "General" }).click();
  // The list: both files, below config.toml, with what happened to them.
  const files = dialog.getByRole("list", { name: "Config files", exact: true });
  await expect(files.getByRole("listitem")).toHaveCount(4);
  await expect(files.getByRole("listitem").nth(0)).toContainText("colors.toml");
  await expect(files.getByRole("listitem").nth(0)).toContainText(
    "included by config.toml",
  );
  await expect(files.getByRole("listitem").nth(1)).toContainText("not found");
  await expect(
    files.getByRole("button", { name: "Open gone.toml" }),
  ).toBeDisabled();
  await expect(
    files.getByRole("button", { name: "Open colors.toml" }),
  ).toBeEnabled();

  // The missing file is also named as a warning.
  await expect(
    dialog.getByRole("list", { name: "Problems in config files" }),
  ).toContainText("include not found: /e2e/dots/gone.toml (skipped)");

  // A value set in the included file: its chip names the file.
  await dialog.getByRole("tab", { name: "Interface" }).click();
  const row = dialog.locator('[data-setting-id="thumbnails"]');
  await expect(
    row.getByRole("switch", { name: /Show drawing thumbnails/ }),
  ).not.toBeChecked();
  const chip = row.getByRole("button", { name: /^Value from/ });
  await expect(chip).toHaveText("colors.toml");
  await chip.click();
  await expect(row.getByRole("group", { name: "Value source" })).toContainText(
    "Set in colors.toml",
  );
  expect(errors).toEqual([]);
});
