import { expect, test, type Page } from "@playwright/test";

import { clickMainMenuItem, openVault, trackErrors } from "./helpers";
import { live, near, pixelAtScene, seedAndOpen } from "./pageHelpers";

// "Import Obsidian vault…" through the real UI: click the main-menu entry, the (fake) folder
// dialog returns a small Obsidian vault, and the converted notes and drawing land in a folder
// of the open vault, with their links rewritten to the converted drawings. The source folder is
// only read: its files are identical afterwards.

// A red 40x40 SVG: a picture a drawing can hold, made of text so the fake source can carry it.
// (The e2e Markdown parser is a stand-in without image blocks, so the picture check is on the converted
// drawing; images inside notes are covered by the plugin's unit tests and the packaged run.)
const PIC = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#ff0000"/></svg>`;
const PIC_URL = `data:image/svg+xml;base64,${Buffer.from(PIC).toString("base64")}`;

const SKETCH = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [
    {
      id: "img1",
      type: "image",
      x: 0,
      y: 0,
      width: 120,
      height: 120,
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
      status: "saved",
      fileId: "f1",
      scale: [1, 1],
    },
  ],
  appState: {},
  files: {
    f1: { id: "f1", mimeType: "image/svg+xml", dataURL: PIC_URL, created: 1 },
  },
});

const SOURCE = {
  name: "Obsidian Notes",
  files: {
    "Home.md":
      "# Home\n\nSee [[Projects/Plan]] and [[Plan|the plan]] and [[Sketch]].\n",
    "Projects/Plan.md": "# Plan\n\nBack to [[Home]].\n",
    "Drawings/Sketch.excalidraw.md": `## Drawing\n\`\`\`json\n${SKETCH}\n\`\`\`\n`,
    "attachments/pic.svg": PIC,
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

  // The converted drawing keeps its embedded picture too.
  await row(page, "Obsidian Notes/Drawings/Sketch.excalidraw").click();
  await expect
    .poll(
      async () => {
        const img = (await live(page)).elements.find((e) => e.type === "image");
        return img
          ? near(
              await pixelAtScene(
                page,
                img.x + img.width / 2,
                img.y + img.height / 2,
              ),
              [255, 0, 0],
              40,
            )
          : false;
      },
      { timeout: 20_000 },
    )
    .toBe(true);

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
