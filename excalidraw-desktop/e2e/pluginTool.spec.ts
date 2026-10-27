import { expect, test, type Page } from "@playwright/test";

import { canvasBox, openVault, readScene, trackErrors } from "./helpers";
import { seedAndOpen } from "./pageHelpers";

// The tool-demo example (sdk/examples/tool-demo) through the real UI: its toolbar button
// shows without loading the plugin; choosing it loads the plugin and presses the button;
// a drag on the canvas draws a box, which is saved in the drawing.

const mainRequests = (page: Page) => {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (/\/e2e-plugins\/tool-demo\/main\.js/.test(r.url())) {
      urls.push(r.url());
    }
  });
  return urls;
};

test("a plugin tool button is pressed on click and a drag on the canvas draws with it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const mains = mainRequests(page);
  await openVault(page, "?plugins=tool-demo");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  const button = page.getByRole("button", { name: "Box" });
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect(mains).toEqual([]);

  const before = (await readScene(page, "Start.excalidraw")).elements.length;
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  expect(mains.length).toBeGreaterThan(0);

  const box = await canvasBox(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 4 });
  await page.mouse.move(x + 120, y + 80, { steps: 4 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const els = (await readScene(page, "Start.excalidraw")).elements;
      return els.length - before;
    })
    .toBe(1);
  const els = (await readScene(page, "Start.excalidraw")).elements;
  expect(els[els.length - 1]).toMatchObject({ type: "rectangle" });

  // Like Excalidraw's own tools it is used once, then selecting is back (unless the tool is locked).
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});
