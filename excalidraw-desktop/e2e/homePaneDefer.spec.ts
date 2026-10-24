import { expect, test } from "@playwright/test";

import { enterVault, trackErrors } from "./helpers";

// interface.defer_home_pane (default on): the home pane mounts one frame after
// the file tree paints, in the same box, so nothing shifts.
test("opening a vault shows the tree, then the home pane in the same place", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto("/e2e.html");
  await enterVault(page);

  const pane = page.locator(".vault-home").first();
  await expect(pane).toBeVisible();
  const early = await pane.boundingBox();

  await expect(
    pane.getByRole("heading", { name: /No Drawing Open/i }),
  ).toBeVisible();
  await expect(pane.locator(".vault-home__action")).toHaveCount(4);
  expect(await pane.boundingBox()).toEqual(early);
  await expect(
    page.getByLabel("Vault File Navigator").locator("[data-tree-path]").first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
