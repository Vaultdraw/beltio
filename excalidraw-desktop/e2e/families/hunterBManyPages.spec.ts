import { expect } from "@playwright/test";

import { test } from "../fixture";
import { trackErrors, openVault } from "../helpers";
import {
  A4,
  focusCanvas,
  live,
  rect,
  runCommand,
  seedAndOpen,
  setupOf,
} from "../pageHelpers";

// Hunter B round 4: page mode with 120 pages: PageDown/PageUp walk to the last and first page and
// stop there, content on a far page stays, switching layout and mode keeps the page count.
const PITCH = A4.height + 40;
const TOP = 72; // PAGE_TOP_MARGIN in src/page/pageView.ts
const PAGES = 120;

test("hunter B: 120 pages: PageDown/PageUp stop at the ends; layout and mode switches keep the pages and the content", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await openVault(page);
  await seedAndOpen(page, "Many.excalidraw", {
    pageSetup: setupOf({ pageCount: PAGES }),
    elements: [rect("far", 100, 100 * PITCH + 200), rect("near", 100, 200)],
  });
  await focusCanvas(page);
  const z = (await live(page)).zoom;
  const at = (i: number) => -(i * PITCH) + TOP / z;
  for (let i = 0; i < PAGES + 8; i++) {
    await page.keyboard.press("PageDown");
  }
  await expect
    .poll(async () => (await live(page)).scrollY, { timeout: 15_000 })
    .toBeCloseTo(at(PAGES - 1), 0);
  expect((await live(page)).pageSetup!.pageCount).toBe(PAGES);
  for (let i = 0; i < PAGES + 8; i++) {
    await page.keyboard.press("PageUp");
  }
  await expect
    .poll(async () => (await live(page)).scrollY, { timeout: 15_000 })
    .toBeCloseTo(at(0), 0);
  // continuous layout and back to separate: same page count and elements
  await runCommand(page, "Page layout: Continuous");
  await expect
    .poll(async () => (await live(page)).pageSetup?.layout)
    .toBe("continuous");
  expect((await live(page)).pageSetup!.pageCount).toBe(PAGES);
  expect((await live(page)).elements.length).toBe(2);
  await runCommand(page, "Page layout: Separate pages");
  await expect
    .poll(async () => (await live(page)).pageSetup?.layout)
    .toBe("separate");
  expect((await live(page)).pageSetup!.pageCount).toBe(PAGES);
  // page mode off and on again
  await runCommand(page, "Page mode: Off");
  await expect
    .poll(async () => (await live(page)).pageSetup?.enabled)
    .toBe(false);
  await runCommand(page, "Page mode: On");
  await expect
    .poll(async () => (await live(page)).pageSetup?.enabled)
    .toBe(true);
  expect((await live(page)).pageSetup!.pageCount).toBe(PAGES);
  expect((await live(page)).elements.map((e) => e.id).sort()).toEqual([
    "far",
    "near",
  ]);
  expect(errors).toEqual([]);
});
