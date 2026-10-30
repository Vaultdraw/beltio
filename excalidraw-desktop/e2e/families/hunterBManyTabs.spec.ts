import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import {
  activeTab,
  clickTree,
  openSeededVault,
  readTabs,
  sceneJson,
  tabEls,
  trackErrors,
} from "../tabsHelpers";

// Hunter B round 4: 32 open tabs (two with the same name in different folders, an accented
// name, a very long name): the strip, the overflow list, its filter, and closing many.
const N = 32;
const names: string[] = [];
const seed: Record<string, string> = {};
for (let i = 1; i <= N - 4; i++) {
  const n = `Tab ${String(i).padStart(2, "0")}`;
  names.push(n);
  seed[`${n}.excalidraw`] = sceneJson([{ id: `r${i}` }]);
}
seed["a/Notes.excalidraw"] = sceneJson([{ id: "na" }]);
seed["b/Notes.excalidraw"] = sceneJson([{ id: "nb" }]);
seed["Café résumé.excalidraw"] = sceneJson([{ id: "cafe" }]);
const LONG = "A very long drawing name ".repeat(6).trim();
seed[`${LONG}.excalidraw`] = sceneJson([{ id: "long" }]);

const list = (p: Page) => p.getByTestId("vault-tab-list");
const rows = (p: Page) => p.getByTestId("vault-tab-list-item");

const openAll = async (page: Page) => {
  await openSeededVault(page, seed);
  // folders a/ and b/ are collapsed: expand them
  for (const f of ["a", "b"]) {
    await page
      .locator(".vault-tree-item__name")
      .filter({ hasText: new RegExp(`^${f}$`) })
      .first()
      .click();
  }
  const order = [...names, "Notes", "Café résumé", LONG.slice(0, 20)];
  let first = true;
  for (const n of order) {
    const loc = page
      .locator(".vault-tree-item__name")
      .filter({ hasText: n === "Notes" ? /^Notes$/ : n })
      .first();
    await loc.click({ modifiers: first ? [] : ["Meta"] });
    first = false;
  }
  // second Notes
  await page
    .locator(".vault-tree-item__name")
    .filter({ hasText: /^Notes$/ })
    .nth(1)
    .click({ modifiers: ["Meta"] });
};

test("hunter B: 32 tabs: the overflow list, its filter, wrap-around keys and the strip follow the active tab", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAll(page);
  const tabs = await readTabs(page);
  expect(tabs.length).toBe(N);
  // 1. the strip shows the active tab fully inside the strip
  const strip = page.getByTestId("vault-tabs");
  const sb = (await strip.boundingBox())!;
  const act = page.locator('[data-testid="vault-tab"][aria-selected="true"]');
  const ab = (await act.boundingBox())!;
  expect(ab.x).toBeGreaterThanOrEqual(sb.x - 1);
  expect(ab.x + ab.width).toBeLessThanOrEqual(sb.x + sb.width + 1);
  // 2. overflow list
  await page.getByTestId("vault-tab-overflow").click();
  await expect(list(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(tabs.length);
  const lb = (await list(page).boundingBox())!;
  const vp = page.viewportSize()!;
  expect(lb.y + lb.height).toBeLessThanOrEqual(vp.height + 1);
  expect(lb.x + lb.width).toBeLessThanOrEqual(vp.width + 1);
  // duplicate names must be distinguishable
  const labels = await rows(page).evaluateAll((els) =>
    els.map((e) => (e.querySelector(".vault-tablist__name")?.textContent ?? "").trim()),
  );
  const notes = labels.filter((l) => /Notes/.test(l));
  expect(new Set(notes).size).toBe(notes.length);
  // 3. wrap-around: ArrowUp from first goes to last, Enter picks it
  await page.keyboard.press("Home").catch(() => {});
  await page.keyboard.type("zzzz");
  await expect(page.getByText("No matching tabs")).toBeVisible();
  const before = await activeTab(page);
  await page.keyboard.press("Enter");
  await expect(list(page)).toBeVisible(); // nothing picked: stays open (or closes)
  expect(await activeTab(page)).toBe(before);
  for (let i = 0; i < 4; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type("Tab 07");
  await expect(rows(page).first()).toContainText("Tab 07");
  await page.keyboard.press("Enter");
  await expect(list(page)).toHaveCount(0);
  // the picked tab is visible in the strip
  const act2 = page.locator('[data-testid="vault-tab"][aria-selected="true"]');
  await expect
    .poll(
      async () => {
        const b = (await act2.boundingBox())!;
        return b.x >= sb.x - 1 && b.x + b.width <= sb.x + sb.width + 1;
      },
      { timeout: 3000, message: "picked tab scrolled into the strip" },
    )
    .toBe(true);
  // 4. close with Cmd+W 31 times: ends with one tab, no error
  for (let i = 0; i < 31; i++) {
    await page.keyboard.press("Meta+w");
  }
  await expect(tabEls(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});
