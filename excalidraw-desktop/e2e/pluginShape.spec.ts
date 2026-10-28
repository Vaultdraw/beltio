/* eslint-disable no-eval -- evaluates appHandle (a string) in the page to reach the editor instance */
import { expect, test, type Page } from "@playwright/test";

import { appHandle } from "./formulaHelpers";
import { openVault, readScene, trackErrors } from "./helpers";
import { runCommand, seedAndOpen } from "./pageHelpers";

// The shape-demo example (sdk/examples/shape-demo) through the real UI: its toolbar button
// shows without loading the plugin; a click loads it and adds the badge, an SVG image that
// the drawing keeps (so the file opens without the plugin) with the shape's props as data.

const mainRequests = (page: Page) => {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (/\/e2e-plugins\/shape-demo\/main\.js/.test(r.url())) {
      urls.push(r.url());
    }
  });
  return urls;
};

test("a plugin shape button inserts an SVG image that the drawing keeps", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const mains = mainRequests(page);
  await openVault(page, "?plugins=shape-demo");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  const button = page.getByRole("button", { name: "Badge" });
  await expect(button).toBeVisible();
  expect(mains).toEqual([]);

  await button.click();
  await expect
    .poll(async () => {
      const scene = await readScene(page, "Start.excalidraw");
      return scene.elements.filter((e: any) => e.type === "image").length;
    })
    .toBe(1);
  expect(mains.length).toBeGreaterThan(0);

  const scene = await readScene(page, "Start.excalidraw");
  const badge = scene.elements.find((e: any) => e.type === "image");
  expect(badge).toMatchObject({ width: 120, height: 120 });
  expect(JSON.stringify(badge.customData)).toContain('"shape":"badge"');
  const file = Object.values<any>(scene.files)[0];
  expect(file.mimeType).toBe("image/svg+xml");

  // An update draws the badge again on the same element: same id, group and arrow binding.
  const live = () =>
    page.evaluate((code) => {
      const app = (0, eval)(code as string);
      const e = app.scene
        .getNonDeletedElements()
        .find((x: any) => x.type === "image");
      return {
        id: e.id,
        fileId: e.fileId,
        groupIds: e.groupIds,
        boundElements: e.boundElements,
      };
    }, appHandle);
  const first = await live();
  await page.evaluate(
    ([code, id]) => {
      const app = (0, eval)(code as string);
      app.updateScene({
        elements: app.scene.getElementsIncludingDeleted().map((e: any) =>
          e.id === id
            ? {
                ...e,
                groupIds: ["g-keep"],
                boundElements: [{ id: "arrow-keep", type: "arrow" }],
              }
            : e,
        ),
      });
    },
    [appHandle, first.id] as const,
  );
  await runCommand(page, "Shape demo: mark every badge Done");
  await expect.poll(async () => (await live()).fileId).not.toBe(first.fileId);
  expect(await live()).toMatchObject({
    id: first.id,
    groupIds: ["g-keep"],
    boundElements: [{ id: "arrow-keep", type: "arrow" }],
  });
  expect(errors).toEqual([]);
});
