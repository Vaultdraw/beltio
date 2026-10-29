import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";
import { seedAndOpen } from "./pageHelpers";

// Imported notes keep Obsidian's line breaks and the order of pictures and text. The note is
// shaped like a real one (`Data Modelling`): a picture first, then three text lines with
// single line breaks. Through the real UI: right-click the canvas, "Import file…".

const NOTE = "![[Ink 1.ink.png|599]]\nline one\nline two\nline three\n";

type El = { type: string; y: number; text?: string };

/** The live elements read from the editor instance, top to bottom. */
const readElements = (page: Page): Promise<El[]> =>
  page.evaluate(() => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
    let fiber = (el as any)[key];
    while (fiber) {
      const s = fiber.stateNode;
      if (s && s.scene && s.state && typeof s.state.scrollX === "number") {
        return s.scene
          .getNonDeletedElements()
          .map((e: any) => ({ type: e.type, y: e.y, text: e.text }))
          .sort((a: El, b: El) => a.y - b.y);
      }
      fiber = fiber.return;
    }
    throw new Error("editor instance not found");
  });

test("an imported note keeps its line breaks and shows the picture above the text", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");

  await page.locator(".vault-editor canvas.interactive").click({
    button: "right",
    position: { x: 300, y: 200 },
  });
  const item = page
    .locator(".context-menu")
    .getByRole("button", { name: "Import file…" });
  const chooser = page.waitForEvent("filechooser");
  await item.click();
  await (
    await chooser
  ).setFiles({
    name: "Data Modelling.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(NOTE),
  });
  const tab = page.locator('[data-testid="vault-tab"][data-active="true"]');
  await expect(tab).toHaveAttribute(
    "data-path",
    "Data Modelling (imported).excalidraw",
    { timeout: 20_000 },
  );

  await expect
    .poll(
      async () => (await readElements(page)).some((e) => e.type === "text"),
      {
        timeout: 20_000,
      },
    )
    .toBe(true);
  const els = await readElements(page);
  const picture = els.find(
    (e) => e.type === "text" && e.text === "Ink 1.ink.png",
  );
  const lines = els.find((e) => e.text?.startsWith("line one"));
  // Three lines, one text, each on its own line (Obsidian shows a single line break).
  expect(lines?.text).toBe("line one\nline two\nline three");
  // The picture (a box here: the file is not in the vault) comes first, above the text.
  expect(picture).toBeTruthy();
  expect(picture!.y).toBeLessThan(lines!.y);
  expect(errors).toEqual([]);
});
