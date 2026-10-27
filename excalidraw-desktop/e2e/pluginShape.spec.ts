import { expect, test, type Page } from "@playwright/test";

import { openVault, readScene, trackErrors } from "./helpers";
import { seedAndOpen } from "./pageHelpers";

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
  expect(errors).toEqual([]);
});
