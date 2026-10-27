import { expect, test, type Page } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";
import { live, seedAndOpen } from "./pageHelpers";

// The official markdown-import plugin through the real UI: right-click the canvas,
// "Import file…", pick a .md. The note opens as its own page-mode drawing,
// `Note (imported).excalidraw`, with the heading text on the canvas. The plugin's
// code loads only at that moment.

const NOTE = [
  "# Quarterly plan",
  "",
  "The first paragraph has a few plain words in it.",
  "",
  "## Details",
  "",
  "- one",
  "- two",
  "",
].join("\n");

const mainRequests = (page: Page) => {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (/\/e2e-plugins\/markdown-import\/main\.js/.test(r.url())) {
      urls.push(r.url());
    }
  });
  return urls;
};

/** The live text elements, read from the editor instance (found through React's fibers). */
const readTexts = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
    let fiber = (el as any)[key];
    while (fiber) {
      const s = fiber.stateNode;
      if (s && s.scene && s.state && typeof s.state.scrollX === "number") {
        return s.scene
          .getNonDeletedElements()
          .filter((e: any) => e.type === "text")
          .map((e: any) => e.text as string);
      }
      fiber = fiber.return;
    }
    throw new Error("editor instance not found");
  });

test("right-click canvas → Import file… with a .md opens `Note (imported)` in page mode", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const mains = mainRequests(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  expect(mains).toEqual([]);

  await page.locator(".vault-editor canvas.interactive").click({
    button: "right",
    position: { x: 300, y: 200 },
  });
  const item = page
    .locator(".context-menu")
    .getByRole("button", { name: "Import file…" });
  await expect(item).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await item.click();
  await (
    await chooser
  ).setFiles({
    name: "Note.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(NOTE),
  });

  // The new drawing is open in its own tab.
  const tab = page.locator('[data-testid="vault-tab"][data-active="true"]');
  await expect(tab).toHaveAttribute("data-path", "Note (imported).excalidraw", {
    timeout: 20_000,
  });
  expect(mains).toHaveLength(1);

  // Page mode is on, and the heading text is on the canvas.
  await expect.poll(async () => (await live(page)).pageSetup).not.toBeNull();
  await expect
    .poll(() => readTexts(page), { timeout: 20_000 })
    .toEqual(
      expect.arrayContaining([expect.stringContaining("Quarterly plan")]),
    );
  expect(errors).toEqual([]);
});
