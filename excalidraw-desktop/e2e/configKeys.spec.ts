import { expect, test } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";

// A typo in config.toml is a warning (a toast, listed in Settings), never
// fatal and never the persistent error banner: the rest of the file still
// applies, and fixing it clears the notice.
test("an unknown config.toml key is a warning in a toast and in Settings, and Reload clears it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    (window as any).__e2eConfig = {
      interface: { zom: 120 },
      tabs: { enabled: true },
    };
  });
  await openVault(page, "?config=1");

  const message =
    "config.toml: unknown key interface.zom (ignored; did you mean interface.zoom?)";
  await expect(page.locator(".vd-toast")).toContainText(message);
  await expect(page.getByTestId("settings-problem-banner")).toHaveCount(0);

  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "General" }).click();
  const problems = dialog.getByRole("list", {
    name: "Problems in config files",
  });
  await expect(problems.getByRole("listitem")).toHaveText([message]);
  await expect(problems.getByRole("listitem")).toHaveClass(
    "vault-config-problem--warning",
  );

  // Reload with the typo still there succeeds, with a warning.
  const reload = dialog.getByRole("button", { name: "Reload" });
  await reload.click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Reloaded the config files with 1 warning (listed above).",
  );

  // The user fixes the typo in the file, then presses Reload.
  await page.evaluate(() => {
    (window as any).__e2eConfig = { interface: { zoom: 120 } };
  });
  await reload.click();
  await expect(problems).toHaveCount(0);
  await expect(dialog.getByRole("status")).toHaveText(
    "Reloaded the config files.",
  );
  expect(errors).toEqual([]);
});
