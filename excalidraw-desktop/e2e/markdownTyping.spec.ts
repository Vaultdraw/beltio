import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "./helpers";
import { personalPath } from "./mainCheckout";

// Markdown mode, through visible UI only: the footer chip turns it on, the
// text tool and the keyboard type "# Title", Enter, "body". Two text boxes:
// a heading 1 (role h1, twice the size) and body text right below it.
const DRAWING = "DSA/Graphs.excalidraw";
const SHOTS = personalPath("feature/markdown-typing/shots");
const textarea = "textarea.excalidraw-wysiwyg";
const editor = (page: Page) => page.locator(".vault-editor");
const chip = (page: Page) => editor(page).getByTestId("markdown-chip");

const live = async (page: Page) =>
  (await readScene(page, DRAWING)).elements.filter(
    (el: any) => !el.isDeleted && el.type === "text",
  );
const textWith = async (page: Page, text: string) =>
  (await live(page)).find((el: any) => el.text === text);

test("Markdown mode: # Title, Enter, body makes a heading and body text below it; the switch is saved with the drawing", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");

  // off by default; the chip turns it on
  await expect(chip(page)).toHaveAttribute("aria-pressed", "false");
  await chip(page).click();
  await expect(chip(page)).toHaveAttribute("aria-pressed", "true");

  // text tool, click empty canvas, type
  await editor(page).getByTestId("toolbar-text").click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.8);
  await expect(page.locator(textarea)).toBeFocused();
  await page.keyboard.type("# Title", { delay: 20 });
  // the # went the moment the space was typed
  await expect(page.locator(textarea)).toHaveValue("Title");
  await page.keyboard.press("Enter");
  await expect(page.locator(textarea)).toHaveValue("");
  await page.keyboard.type("body", { delay: 20 });
  await page.keyboard.press("Escape");
  await expect(page.locator(textarea)).toHaveCount(0);

  await expect
    .poll(async () => !!(await textWith(page, "body")), { timeout: 10_000 })
    .toBe(true);
  const title = await textWith(page, "Title");
  const body = await textWith(page, "body");
  expect(title.customData).toEqual({ role: "h1" });
  expect(body.customData ?? null).toBeNull();
  expect(title.fontSize).toBe(body.fontSize * 2);
  // a heading is in the bold variant of the font (regular id + 100), the body is not
  expect(title.fontFamily).toBe(body.fontFamily + 100);
  expect(body.x).toBeCloseTo(title.x, 5);
  expect(body.y).toBeGreaterThan(title.y + title.height);

  await page.screenshot({ path: `${SHOTS}/01-heading-light.png` });

  // the switch is saved in the drawing and comes back when it is opened
  // again (the browser test vault does not survive a page reload)
  expect((await readScene(page, DRAWING)).vaultdraw?.markdown).toBe(true);
  await page
    .locator(".vault-tree-item__name", { hasText: "Dynamic Programming" })
    .first()
    .click();
  await openDrawing(page, "Introduction");
  await expect(chip(page)).toHaveAttribute("aria-pressed", "false");
  await openDrawing(page, "Graphs");
  await expect(chip(page)).toHaveAttribute("aria-pressed", "true");

  // off again: # stays plain text, the heading stays a heading
  await chip(page).click();
  await expect(chip(page)).toHaveAttribute("aria-pressed", "false");
  await editor(page).getByTestId("toolbar-text").click();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await expect(page.locator(textarea)).toBeFocused();
  await page.keyboard.type("# plain", { delay: 20 });
  await expect(page.locator(textarea)).toHaveValue("# plain");
  await page.keyboard.press("Escape");
  await expect.poll(async () => !!(await textWith(page, "# plain"))).toBe(true);
  expect((await textWith(page, "Title")).customData).toEqual({ role: "h1" });
  expect((await readScene(page, DRAWING)).vaultdraw?.markdown).toBe(false);

  expect(errors).toEqual([]);
});

test("Markdown mode in dark: lists, tasks (Toggle task) and a quote; the Settings default turns it on for the drawing", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");

  // Settings: dark mode, and Markdown mode on for drawings without a switch
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
  await dialog
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: "Dark" })
    .click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await dialog.getByRole("tab", { name: "Drawing", exact: true }).click();
  await dialog
    .getByTestId("setting-markdown-typing")
    .getByRole("switch")
    .click();
  await page.screenshot({ path: `${SHOTS}/02-settings-dark.png` });
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(chip(page)).toHaveAttribute("aria-pressed", "true");

  // a list, a task list and a quote, typed like a user
  await editor(page).getByTestId("toolbar-text").click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.55);
  await expect(page.locator(textarea)).toBeFocused();
  await page.keyboard.type("- milk", { delay: 15 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("eggs", { delay: 15 });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("[ ] call mum", { delay: 15 });
  // Toggle task (Cmd/Ctrl+L) on the caret's line
  await page.keyboard.press("ControlOrMeta+l");
  await expect(page.locator(textarea)).toHaveValue(
    "• milk\n• eggs\n☑ call mum",
  );
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("> quoted", { delay: 15 });
  await page.keyboard.press("Escape");
  await expect(page.locator(textarea)).toHaveCount(0);

  await expect
    .poll(async () => !!(await textWith(page, "quoted")), { timeout: 10_000 })
    .toBe(true);
  const list = await textWith(page, "• milk\n• eggs\n☑ call mum");
  const quote = await textWith(page, "quoted");
  expect(list).toBeTruthy();
  expect(list.customData ?? null).toBeNull();
  expect(quote.customData).toEqual({ role: "quote" });
  expect(quote.fontSize).toBe(list.fontSize);
  expect(quote.y).toBeGreaterThan(list.y + list.height);
  await page.screenshot({ path: `${SHOTS}/03-lists-quote-dark.png` });

  expect(errors).toEqual([]);
});
