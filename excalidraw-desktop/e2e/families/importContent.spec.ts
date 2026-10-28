import { expect, test, type Page } from "@playwright/test";

import { clickMainMenuItem, openVault, trackErrors } from "../helpers";
import { live, seedAndOpen } from "../pageHelpers";

// Family: every way a note references a file resolves like Obsidian does, and every Markdown construct
// imports readable (toimprove 68, 69). One note through "Import Obsidian vault…": pictures by name
// and by a path with spaces appear, a web picture stays a labelled box, and the table is a grid with
// wrapped cells (no "…" and no box characters). Resolution forms and constructs are swept in the
// plugin's unit tests (test/obsidian/imageResolution.test.ts, test/layout/constructs.test.ts).

const PIC = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#ff0000"/></svg>`;

const LONG =
  "Translates virtual addresses into physical addresses and enforces access permissions on every page access made by running programs.";

const NOTE = [
  "# Hardware",
  "![[pic.svg|120]]",
  "![alt text](my pics/a b.svg)",
  "![Close-up of a chip](https://example.org/chip.png)",
  `| Concept | Main responsibility |\n|---|---|\n| Paging | ${LONG} |\n| MMU | Hardware that performs address translation and protection checks. |`,
  "After the table.",
].join("\n\n");

const SOURCE = {
  name: "Obsidian Notes",
  files: {
    "Notes/Hardware.md": NOTE,
    "attachments/pic.svg": PIC,
    "Notes/my pics/a b.svg": PIC,
    ".obsidian/app.json": '{"attachmentFolderPath":"attachments"}',
  } as Record<string, string>,
};

const elements = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
    let fiber = (el as any)[key];
    while (fiber) {
      const s = fiber.stateNode;
      if (s && s.scene && s.state && typeof s.state.scrollX === "number") {
        return s.scene.getNonDeletedElements().map((e: any) => ({
          type: e.type,
          text: e.text as string | undefined,
        }));
      }
      fiber = fiber.return;
    }
    throw new Error("editor instance not found");
  });

const row = (page: Page, path: string) =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );

test("an imported note shows its pictures and a real table", async ({
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
  await expect(row(page, "Obsidian Notes")).toBeVisible({ timeout: 30_000 });
  await row(page, "Obsidian Notes/Notes")
    .locator(".vault-tree-item__toggle")
    .click();
  await row(page, "Obsidian Notes/Notes/Hardware.excalidraw").click();

  // Pictures: by name (attachments folder) and by a path with spaces; the web one is a labelled box.
  await expect
    .poll(
      async () =>
        (await live(page)).elements.filter((e) => e.type === "image").length,
      {
        timeout: 20_000,
      },
    )
    .toBe(2);
  const els = await elements(page);
  const texts = els
    .filter((e: any) => e.type === "text")
    .map((e: any) => e.text as string);
  expect(texts.some((t) => /Web image, not downloaded/.test(t))).toBe(true);

  // The table: header and cells are there in full, wrapped, with no ellipsis or box characters.
  expect(texts).toContain("Concept");
  expect(texts).toContain("Paging");
  const squashed = texts.join(" ").replace(/\s+/g, "");
  expect(squashed).toContain(LONG.replace(/\s+/g, ""));
  expect(texts.some((t) => t.includes("\n") && t.includes("physical"))).toBe(
    true,
  );
  expect(texts.join("")).not.toMatch(/[…│─┼]/);
  expect(
    els.filter((e: any) => e.type === "line").length,
  ).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});
