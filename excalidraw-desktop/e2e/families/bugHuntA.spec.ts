import { writeFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import {
  clickMainMenuItem,
  openVault,
  readScene,
  trackErrors,
} from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Bug hunter A (2026-10-30): Markdown import scenarios that cross features.
const OUT = "/private/tmp/claude-501/hA";
const PIC = "https://pics.test/a.svg";
const BAD = "https://pics.test/page";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#f00"/></svg>`;

const NOTE = [
  "---",
  "tags: [one, two]",
  "---",
  "# Rich note #tag1",
  "Line one",
  "Line two with **bold** and [[Other note|alias]] and #inline-tag",
  "",
  `![pic](${PIC})`,
  "",
  "Text after pic",
  "",
  `![not a pic](${BAD})`,
  "",
  "| A | B |",
  "|---|---|",
  "| x | y |",
  "",
  "> quote line",
  "",
  "> [!warning] Careful",
  "> callout body",
  "",
  "```ts",
  "const a = 1;",
  "```",
  "",
  "- [ ] task",
  "- [x] done",
  "",
  "![[Other note]]",
  "",
  "## Second",
  "end",
].join("\n");

const row = (page: Page, path: string) =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );

const dump = (scene: any) =>
  scene.elements
    .filter((e: any) => !e.isDeleted)
    .map((e: any) => ({
      t: e.type,
      x: Math.round(e.x),
      y: Math.round(e.y),
      w: Math.round(e.width),
      h: Math.round(e.height),
      text: e.text,
      stroke: e.strokeColor,
      link: e.link,
      role: e.customData?.["plugins.markdown-import"],
    }));

test("hunt: rich note import then every theme", async ({ page }) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  await page.evaluate(
    ([note, pic, bad, s]) => {
      const b = (window as any).__plugins.backend;
      b.network.images = {
        [pic]: new TextEncoder().encode(s),
        [bad]: "NOT_AN_IMAGE",
      };
      b.folders.sourcePick = {
        name: "Vault",
        files: {
          "Rich.md": note,
          "Other note.md": "other body",
          "Sub dir/Nested ünï 😀.md": "# nested\n\nbody",
        },
      };
    },
    [NOTE, PIC, BAD, svg] as const,
  );
  await clickMainMenuItem(page, "Import Obsidian vault…");
  await expect(row(page, "Vault")).toBeVisible({ timeout: 30_000 });
  await row(page, "Vault/Rich.excalidraw").click();
  await page.waitForTimeout(3000);
  const scene = await readScene(page, "Vault/Rich.excalidraw");
  writeFileSync(`${OUT}/rich.json`, JSON.stringify(dump(scene), null, 1));
  const tree = await page.locator(".vault-tree-item__name").allInnerTexts();
  writeFileSync(`${OUT}/tree.json`, JSON.stringify(tree));
  const toasts = await page.locator("[role=status], .vault-toast").allInnerTexts();
  writeFileSync(`${OUT}/toasts.json`, JSON.stringify(toasts));
  expect(errors).toEqual([]);
});

const textsOf = async (page: Page, path: string): Promise<string[]> =>
  (await readScene(page, path)).elements
    .filter((e: any) => e.type === "text" && !e.isDeleted)
    .map((e: any) => e.text as string);

test("hunt: Re-import from a non-active tab's menu rewrites the clicked tab's note", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  const pick = (a: string, b: string) =>
    page.evaluate(
      ([x, y]) => {
        (window as any).__plugins.backend.folders.sourcePick = {
          name: "Vault",
          files: { "Alpha.md": x, "Beta.md": y },
        };
      },
      [a, b],
    );
  await pick("alpha v1", "beta v1");
  await clickMainMenuItem(page, "Import Obsidian vault…");
  await expect(row(page, "Vault")).toBeVisible({ timeout: 30_000 });
  await row(page, "Vault/Alpha.excalidraw").click();
  await row(page, "Vault/Beta.excalidraw").click({ modifiers: ["Meta"] });
  await expect(
    page.locator('[data-testid="vault-tab"][data-active="true"]'),
  ).toContainText("Beta");
  await pick("alpha v2", "beta v2");
  // Right-click the Alpha tab (Beta is the active one).
  await page
    .getByTestId("vault-tab")
    .filter({ hasText: "Alpha" })
    .click({ button: "right" });
  await page
    .getByTestId("vault-tab-menu")
    .getByRole("menuitem", { name: "Markdown: Re-import this note from its Markdown" })
    .or(
      page
        .getByTestId("vault-tab-menu")
        .getByRole("menuitem", { name: "Re-import from its Markdown" }),
    )
    .first()
    .click();
  await expect(page.getByText("Re-imported 1 note")).toBeVisible({
    timeout: 30_000,
  });
  const after = {
    alpha: (await textsOf(page, "Vault/Alpha.excalidraw")).join(" "),
    beta: (await textsOf(page, "Vault/Beta.excalidraw")).join(" "),
  };
  expect(after.alpha).toContain("alpha v2");
  expect((await textsOf(page, "Vault/Beta.excalidraw")).join(" ")).toContain(
    "beta v1",
  );
  expect(errors).toEqual([]);
});
