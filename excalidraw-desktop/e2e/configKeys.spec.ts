import { expect, test } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";

// A typo in config.toml is reported (banner + Settings), never fatal: the
// rest of the file still applies, and fixing it clears the notice.
test("an unknown config.toml key shows in the banner and in Settings, and Reload clears it", async ({
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

  const banner = page.getByTestId("settings-problem-banner");
  await expect(banner).toContainText(
    "config.toml: unknown key interface.zom (ignored; did you mean interface.zoom?)",
  );

  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "General" }).click();
  const problems = dialog.getByRole("list", {
    name: "Problems in config.toml",
  });
  await expect(problems.getByRole("listitem")).toHaveText([
    "config.toml: unknown key interface.zom (ignored; did you mean interface.zoom?)",
  ]);

  // The user fixes the typo in the file, then presses Reload.
  await page.evaluate(() => {
    (window as any).__e2eConfig = { interface: { zoom: 120 } };
  });
  await dialog.getByRole("button", { name: "Reload" }).click();
  await expect(problems).toHaveCount(0);
  await expect(dialog.getByRole("status")).toHaveText("Reloaded config.toml.");
  await expect(banner).toHaveCount(0);
  expect(errors).toEqual([]);
});
