import { expect, test } from "@playwright/test";

import { SCENE_A, SCENE_B } from "./frameCapture";
import { clickTree, openSeededVault, sceneIds } from "./tabsHelpers";

import type { Page } from "@playwright/test";

// Opening another drawing reuses the editor (scene swap): the new scene is
// drawn once, in the landing frame. Every extra static render is a full
// re-draw of the scene (a second rasterisation pass at 6x CPU throttle cost
// ~8-12 ms per swap). Counts, not timings: holds under load.

const prefixOf = (name: "Alpha" | "Beta") => (name === "Alpha" ? "sa" : "sb");

const shows = async (page: Page, name: "Alpha" | "Beta") => {
  await expect
    .poll(() => sceneIds(page).then((ids) => ids[0]), { timeout: 10_000 })
    .toMatch(new RegExp(`^${prefixOf(name)}-`));
};

/** Static renders from now until `settleMs` after the scene shows `name`. */
const rendersWhileOpening = async (page: Page, name: "Alpha" | "Beta") => {
  await page.evaluate(() => {
    const w = window as any;
    w.__staticRenders = 0;
    const canvas = document.querySelector<HTMLCanvasElement>(
      ".vault-editor canvas.static",
    )!;
    const original = HTMLCanvasElement.prototype.getContext;
    canvas.getContext = function (this: HTMLCanvasElement, ...args: any) {
      w.__staticRenders++;
      return (original as any).apply(this, args);
    } as any;
  });
  await clickTree(page, name);
  await shows(page, name);
  await page.waitForTimeout(700); // fonts, link styling, idle work
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      ".vault-editor canvas.static",
    )!;
    delete (canvas as any).getContext;
    return (window as any).__staticRenders as number;
  });
};

test("a scene swap draws the new drawing once", async ({ page }) => {
  await openSeededVault(page, {
    "Alpha.excalidraw": SCENE_A,
    "Beta.excalidraw": SCENE_B,
  });
  await clickTree(page, "Alpha");
  await shows(page, "Alpha");
  await page.waitForTimeout(700);

  const counts: number[] = [];
  for (const name of ["Beta", "Alpha", "Beta"] as const) {
    counts.push(await rendersWhileOpening(page, name));
  }
  // eslint-disable-next-line no-console
  console.log(`PERF ${JSON.stringify({ test: "swap-renders", counts })}`);
  for (const count of counts) {
    expect(count).toBe(1);
  }
});
