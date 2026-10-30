import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { openVault, trackErrors } from "../helpers";

// Hunter D round 2: the user edits config.toml by hand in an editor WHILE Settings is open (Neovim
// and Noctalia reload on write; Obsidian reflects a changed settings file). The open dialog must
// follow: a changed key updates its control, a key the user set in Settings itself keeps winning,
// a typo is named and the last good values stay, and fixing the typo recovers.
test.use({ allowedErrors: /Failed to load resource/ });

const edit = (
  page: Page,
  config: unknown,
  error?: { message: string; line: number },
) =>
  page.evaluate(
    ([c, e]) => {
      const w = window as any;
      w.__e2eConfig = c;
      w.__e2eConfigError = e ?? null;
      w.__e2eConfigChanged();
    },
    [config, error ?? null] as const,
  );

test("a hand edit of config.toml while Settings is open reaches the dialog, keeps Settings changes, names a typo and recovers", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    (window as any).__e2eConfig = { interface: { thumbnails: false } };
  });
  await openVault(page, "?config=1");
  await page.keyboard.press("Meta+Comma");
  const d = page.getByRole("dialog");
  await d.getByRole("tab", { name: "Interface" }).click();
  const thumbs = d.getByRole("switch", { name: /Show drawing thumbnails/ });
  await expect(thumbs).not.toBeChecked();

  // 1. hand edit: thumbnails on. The open dialog follows without Reload.
  await edit(page, { interface: { thumbnails: true } });
  await expect(thumbs).toBeChecked();

  // 2. the user changes it in Settings (an override); a later hand edit must not undo it.
  await thumbs.click();
  await expect(thumbs).not.toBeChecked();
  await edit(page, { interface: { thumbnails: true, other: 1 } });
  await page.waitForTimeout(300);
  await expect(thumbs).not.toBeChecked();

  // 3. a typo in config.toml: named, nothing else breaks, values stay.
  await edit(
    page,
    { interface: { thumbnails: true } },
    { message: "expected a value", line: 3 },
  );
  await d.getByRole("tab", { name: "General" }).click();
  await expect(
    d
      .getByRole("list", { name: "Problems in config files" })
      .getByRole("listitem"),
  ).toContainText(["config.toml line 3: expected a value"]);
  await d.getByRole("tab", { name: "Interface" }).click();
  await expect(thumbs).not.toBeChecked();

  // 4. the typo is fixed: the problem list goes away on its own.
  await edit(page, { interface: { thumbnails: true } });
  await d.getByRole("tab", { name: "General" }).click();
  await expect(
    d.getByRole("list", { name: "Problems in config files" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
