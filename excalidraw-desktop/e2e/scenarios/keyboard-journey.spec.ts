import { expect, type Page } from "@playwright/test";

import { openVault } from "../helpers";
import { tabNames } from "../tabsHelpers";

import { journey } from "./journey";

// Journey: a day's work with the keyboard only (no mouse click after the app starts): switch to a
// drawing, make a new one, tabs, search, settings, rename, trash. Tab walks the controls and the
// focus must show where it is at every stop. Vim, Emacs and Zed keep the hands on the keys and
// always show the cursor; here the answer key is the same.

const MOD = "Meta";
const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });

/** Opens the palette with the keyboard, types the query and runs the first match with Enter. */
const runByKey = async (page: Page, query: string, expectTitle: RegExp) => {
  await page.keyboard.press(`${MOD}+Shift+KeyP`);
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type(query);
  const first = palette(page).getByRole("option").first();
  await expect(first).toContainText(expectTitle);
  await page.keyboard.press("Enter");
};

const breadcrumb = (page: Page) => page.locator(".vault-breadcrumbs");

journey({
  title: "keyboard-journey",
  known: [],
  setup: async (page) => {
    await openVault(page);
    // Start with the focus in the page, not in the browser's address bar.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
  },
  steps: [
    {
      name: "Cmd+P, type a name, Enter: the drawing opens",
      keyboard: true,
      run: async (page) => {
        await page.keyboard.press(`${MOD}+KeyP`);
        await expect(palette(page)).toBeVisible();
        await page.keyboard.type("Graphs");
        await expect(palette(page).getByRole("option").first()).toContainText(
          "Graphs",
        );
        await page.keyboard.press("Enter");
        await expect(palette(page)).toHaveCount(0);
        await expect(breadcrumb(page)).toContainText("Graphs");
        await expect(
          page.locator(".vault-editor canvas.interactive"),
        ).toBeVisible();
      },
    },
    {
      name: "Cmd+N: a new drawing is made and opened at once (like a new note in Obsidian)",
      keyboard: true,
      run: async (page, ctx) => {
        await page.keyboard.press(`${MOD}+KeyN`);
        await expect(breadcrumb(page)).not.toContainText("Graphs");
        await expect(
          page.locator(".vault-editor canvas.interactive"),
        ).toBeVisible();
        ctx.data.fresh = (await tabNames(page))[0];
        expect(ctx.data.fresh, "the new drawing has a name").toBeTruthy();
      },
    },
    {
      name: "Cmd+T opens a tab, Cmd+P for an open drawing jumps to its tab, Cmd+2 goes to the second tab",
      keyboard: true,
      run: async (page, ctx) => {
        const before = (await tabNames(page)).length;
        await page.keyboard.press(`${MOD}+KeyT`);
        await expect(page.getByTestId("vault-tab")).toHaveCount(before + 1);
        await page.keyboard.press(`${MOD}+KeyP`);
        await page.keyboard.type("Graphs");
        await page.keyboard.press("Enter");
        // Graphs is open in tab 1 already; the switcher may take that tab or fill this one.
        // Either way a drawing is on screen. Then Cmd+1 and Cmd+2 pick tabs by number.
        await expect(
          page.locator(".vault-editor canvas.interactive"),
        ).toBeVisible();
        const names = await tabNames(page);
        for (const n of [1, 2]) {
          await page.keyboard.press(`${MOD}+Digit${n}`);
          await expect(
            page.locator('[data-testid="vault-tab"][aria-selected="true"]'),
          ).toContainText(names[n - 1]);
        }
      },
    },
    {
      name: "Cmd+Shift+F: search takes the typing and lists the drawing",
      keyboard: true,
      run: async (page) => {
        await page.keyboard.press(`${MOD}+Shift+KeyF`);
        const box = page.getByPlaceholder("Search drawings and text…");
        await expect(box).toBeFocused();
        await page.keyboard.type("Graphs");
        await expect(
          page.locator('.vault-search-row[data-kind="drawing"]').first(),
        ).toBeVisible();
      },
    },
    {
      name: "Cmd+, opens Settings; arrow keys move between pages; Escape closes it",
      keyboard: true,
      check: { dialogs: 1 },
      run: async (page) => {
        await page.keyboard.press(`${MOD}+Comma`);
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const tabs = dialog.getByRole("tab");
        const first = (await tabs.first().innerText()).trim();
        await tabs.first().focus();
        await page.keyboard.press("ArrowDown");
        await expect(
          dialog.locator('[role="tab"][aria-selected="true"]'),
        ).not.toHaveText(first);
      },
    },
    {
      name: "after Escape the focus is somewhere usable, not lost",
      keyboard: true,
      run: async (page, ctx) => {
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        const lost = await page.evaluate(
          () =>
            document.activeElement === document.body ||
            document.activeElement === document.documentElement,
        );
        if (lost) {
          ctx.report(
            "after Escape closes Settings the keyboard focus is lost on the page body",
          );
        }
      },
    },
    {
      name: "palette: Rename the open drawing, Enter: the tab and breadcrumb follow",
      keyboard: true,
      run: async (page) => {
        await runByKey(page, "rename drawing", /Rename drawing/);
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await page.keyboard.press(`${MOD}+KeyA`);
        await page.keyboard.type("Keyboard done");
        await page.keyboard.press("Enter");
        await expect(dialog).toHaveCount(0);
        await expect(breadcrumb(page)).toContainText("Keyboard done");
        await expect.poll(() => tabNames(page)).toContain("Keyboard done");
      },
    },
    {
      name: "palette: Move to Trash, then Enter: the drawing and its tab are gone",
      keyboard: true,
      run: async (page, ctx) => {
        await runByKey(page, "drawing to trash", /Move drawing to Trash/);
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const focused = await page.evaluate(
          () =>
            (document.activeElement as HTMLElement | null)?.innerText?.trim() ??
            "",
        );
        await page.keyboard.press("Enter");
        await expect(dialog).toHaveCount(0);
        await page.waitForTimeout(600);
        const still = (await tabNames(page)).includes("Keyboard done");
        if (still) {
          ctx.report(
            `Enter in the trash question does not trash the drawing (the focus was on "${focused}")`,
          );
          // Finish the job with the confirm button so the journey can go on.
          await runByKey(page, "drawing to trash", /Move drawing to Trash/);
          await page.getByRole("button", { name: "Move to Trash" }).click();
          await expect(dialog).toHaveCount(0);
        }
        await expect.poll(() => tabNames(page)).not.toContain("Keyboard done");
        await expect(
          page.locator(".vault-tree-item__name", { hasText: "Keyboard done" }),
        ).toHaveCount(0);
      },
    },
  ],
});
