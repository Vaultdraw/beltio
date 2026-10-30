import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { openSeededVault, sceneJson, trackErrors } from "../tabsHelpers";

// Family (hunter B-8): a drag inside a scrolling area scrolls it while held at the edge.
// Members: the tab strip (hunterBManyTabs.spec.ts) and the navigator tree (this file).
const N = 70;
const name = (i: number) => `f${String(i).padStart(2, "0")}`;
const seed: Record<string, string> = {};
for (let i = 0; i < N; i++) {
  seed[`${name(i)}/x.excalidraw`] = sceneJson([{ id: `r${i}` }]);
}

const row = (p: Page, path: string) =>
  p.locator(`.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`);

test("hunter B family: dragging a folder to the bottom edge of the tree scrolls it, and the drop lands on a far folder", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1280, height: 700 });
  await openSeededVault(page, seed);
  const tree = page.locator(".vault-tree-container");
  const scroller = page.locator(".vault-tree-body");
  const scrollTop = () =>
    page.evaluate(() => {
      const els = Array.from(document.querySelectorAll("*")).filter(
        (e) =>
          e.scrollHeight > e.clientHeight + 50 &&
          getComputedStyle(e).overflowY !== "visible" &&
          e.closest(".vault-tree-container"),
      );
      return els.length ? Math.max(...els.map((e) => e.scrollTop)) : -1;
    });
  void scroller;
  const src = row(page, name(0));
  await expect(src).toBeVisible();
  const sb = (await src.locator(".vault-tree-item__name").boundingBox())!;
  const tb = (await tree.boundingBox())!;
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + 20, sb.y + 20, { steps: 4 });
  await page.mouse.move(sb.x + 20, tb.y + tb.height - 8, { steps: 15 });
  await expect.poll(scrollTop, { timeout: 8_000 }).toBeGreaterThan(200);
  // held at the edge it keeps scrolling to the end of the tree, then the last folder is in view
  let seen = -1;
  await expect
    .poll(
      async () => {
        const now = await scrollTop();
        const same = now === seen;
        seen = now;
        return same;
      },
      { timeout: 10_000, intervals: [400] },
    )
    .toBe(true);
  const last = row(page, name(N - 1));
  await expect(last).toBeVisible();
  const lb = (await last.locator(".vault-tree-item__name").boundingBox())!;
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await expect
    .poll(
      () =>
        page.evaluate(async (p) => {
          const repo = (window as any).__vaultRepo;
          return (await repo.listDirectory(repo.handle, p)).map(
            (e: any) => e.path as string,
          );
        }, name(N - 1)),
      { timeout: 8_000 },
    )
    .toContain(`${name(N - 1)}/${name(0)}`);
  expect(errors).toEqual([]);
});
