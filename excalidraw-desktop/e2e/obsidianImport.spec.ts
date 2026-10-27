import { expect, test, type Page } from "@playwright/test";

import { clickMainMenuItem, openVault, trackErrors } from "./helpers";
import { seedAndOpen } from "./pageHelpers";

// "Import Obsidian vault…" through the real UI: click the main-menu entry, the (fake) folder
// dialog returns a small Obsidian vault, and the converted notes and drawing land in a folder
// of the open vault, with their links rewritten to the converted drawings. The source folder is
// only read: its files are identical afterwards.

const SKETCH = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [],
  appState: {},
  files: {},
});

const SOURCE = {
  name: "Obsidian Notes",
  files: {
    "Home.md":
      "# Home\n\nSee [[Projects/Plan]] and [[Plan|the plan]] and [[Sketch]].\n",
    "Projects/Plan.md": "# Plan\n\nBack to [[Home]].\n",
    "Drawings/Sketch.excalidraw.md": `## Drawing\n\`\`\`json\n${SKETCH}\n\`\`\`\n`,
    "attachments/pic.png": "not really a png",
    ".obsidian/app.json": "{}",
  } as Record<string, string>,
};

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

const row = (page: Page, path: string) =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );

test("main menu → Import Obsidian vault… converts a vault into a folder, links rewritten, source untouched", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  await page.evaluate((src) => {
    (window as any).__plugins.backend.folders.sourcePick = src;
  }, SOURCE);

  await clickMainMenuItem(page, "Import Obsidian vault…");

  // The converted files show in the file tree, in a folder named like the source.
  await expect(row(page, "Obsidian Notes")).toBeVisible({ timeout: 30_000 });
  await expect(row(page, "Obsidian Notes/Home.excalidraw")).toBeVisible({
    timeout: 30_000,
  });
  for (const sub of ["Projects", "Drawings"]) {
    await row(page, `Obsidian Notes/${sub}`)
      .locator(".vault-tree-item__toggle")
      .click();
  }
  await expect(
    row(page, "Obsidian Notes/Projects/Plan.excalidraw"),
  ).toBeVisible();
  await expect(
    row(page, "Obsidian Notes/Drawings/Sketch.excalidraw"),
  ).toBeVisible();

  // Open the converted note: its links point at the converted drawings.
  await row(page, "Obsidian Notes/Home.excalidraw").click();
  await expect
    .poll(() => readTexts(page).then((t) => t.join("\n")), { timeout: 20_000 })
    .toContain("[[Projects/Plan|the plan]]");
  const texts = (await readTexts(page)).join("\n");
  expect(texts).toContain("[[Projects/Plan]]");
  expect(texts).toContain("[[Drawings/Sketch|Sketch]]");

  // The source was only read.
  const after = await page.evaluate(
    () =>
      Object.values(
        (window as any).__plugins.backend.folders.sources as Record<
          string,
          { files: object }
        >,
      )[0].files,
  );
  expect(after).toEqual(SOURCE.files);
  expect(errors).toEqual([]);
});
