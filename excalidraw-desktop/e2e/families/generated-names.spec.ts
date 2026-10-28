import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { openVault, trackErrors } from "../helpers";

// Family: every generated name (new drawing, drawing from a template) is the next
// free name like Obsidian ("Untitled", "Untitled 1"), never a clash and never an
// error, even when the clock repeats (BH-11). One row per creation path; add a path
// = add a row. Source: toimprove 96.

const files = (page: Page) =>
  page.evaluate(() =>
    [...(window as any).__vaultRepo.files.keys()].filter(
      (p: string) => !p.startsWith("Templates/"),
    ),
  );

const freezeClock = (page: Page) =>
  page.addInitScript(() => {
    const fixed = 1_800_000_001_234;
    Date.now = () => fixed;
  });

const closeTab = async (page: Page) => {
  await page.getByRole("tab").getByRole("button").first().click();
};

type Row = {
  name: string;
  seed: string;
  create: (page: Page) => Promise<void>;
  expected: string[];
};

const ROWS: Row[] = [
  {
    name: "New drawing from the empty state, three times",
    seed: "?seed=empty",
    create: async (page) => {
      await page.getByRole("button", { name: "New Drawing" }).first().click();
    },
    expected: [
      "Untitled.excalidraw",
      "Untitled 1.excalidraw",
      "Untitled 2.excalidraw",
    ],
  },
  {
    name: "drawing from a template, twice",
    seed: "?seed=templates",
    create: async (page) => {
      await page.keyboard.press("Control+Alt+N");
      const dialog = page.getByRole("dialog", {
        name: "New drawing from template",
      });
      await dialog.getByRole("combobox").fill("flowchart");
      await page.keyboard.press("Enter");
      await expect(dialog).toHaveCount(0);
    },
    expected: ["Flowchart.excalidraw", "Flowchart 1.excalidraw"],
  },
];

for (const row of ROWS) {
  test(`generated names: ${row.name}`, async ({ page }) => {
    const errors = trackErrors(page);
    await freezeClock(page);
    await openVault(page, row.seed);
    for (let i = 0; i < row.expected.length; i++) {
      await row.create(page);
      await expect
        .poll(async () => (await files(page)).length)
        .toBeGreaterThan(0);
      await expect(
        page.locator(".vault-editor canvas.interactive"),
      ).toBeVisible();
      await closeTab(page);
    }
    const created = (await files(page)).filter((p: string) =>
      row.expected.includes(p),
    );
    expect(created.sort()).toEqual([...row.expected].sort());
    await expect(page.locator("[role=alert]")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
