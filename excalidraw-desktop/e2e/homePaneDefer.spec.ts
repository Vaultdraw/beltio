import { expect, test } from "@playwright/test";

import { enterVault, trackErrors } from "./helpers";

type Probe = { empties: number; emptyBox: string | null };

// interface.defer_home_pane (default on): at vault open the home pane mounts
// one frame after the file tree paints, in the same box, so nothing shifts;
// closing a drawing shows it at once.
test("opening a vault shows the tree, then the home pane in the same place", async ({
  page,
}) => {
  const errors = trackErrors(page);
  // Records every empty home box (the placeholder) and its size, from before
  // the app's first script runs.
  await page.addInitScript(() => {
    const probe: Probe = { empties: 0, emptyBox: null };
    (window as unknown as { __homeProbe: Probe }).__homeProbe = probe;
    let seen: Element | null = null;
    const check = () => {
      const el = document.querySelector(".vault-home");
      if (el && el !== seen && el.childElementCount === 0) {
        seen = el;
        probe.empties += 1;
        const r = el.getBoundingClientRect();
        probe.emptyBox = `${r.x},${r.y},${r.width},${r.height}`;
      }
    };
    new MutationObserver(check).observe(document, {
      childList: true,
      subtree: true,
    });
  });
  await page.goto("/e2e.html");
  await enterVault(page);

  const pane = page.locator(".vault-home");
  await expect(
    pane.getByRole("heading", { name: /No Drawing Open/i }),
  ).toBeVisible();
  await expect(pane.locator(".vault-home__action")).toHaveCount(4);
  await expect(
    page.getByLabel("Vault File Navigator").locator("[data-tree-path]").first(),
  ).toBeVisible();

  const probe = () =>
    page.evaluate(
      () => (window as unknown as { __homeProbe: Probe }).__homeProbe,
    );
  // The placeholder showed once, in exactly the pane's box.
  const atOpen = await probe();
  expect(atOpen.empties).toBe(1);
  const r = (await pane.boundingBox())!;
  expect(atOpen.emptyBox).toBe(`${r.x},${r.y},${r.width},${r.height}`);

  // Open a recent drawing from the pane, close its tab: the pane is back at once.
  await pane.getByRole("button", { name: /^Graphs/ }).click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await page.getByRole("button", { name: /^Close Graphs/ }).click();
  await expect(
    pane.getByRole("heading", { name: /No Drawing Open/i }),
  ).toBeVisible();
  expect((await probe()).empties).toBe(atOpen.empties);
  expect(errors).toEqual([]);
});
