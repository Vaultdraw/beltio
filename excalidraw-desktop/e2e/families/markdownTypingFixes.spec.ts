import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "../helpers";
import { live, runCommand, seedAndOpen, toClient } from "../pageHelpers";

// Markdown typing fixes (toimprove 162 to 165), through visible UI:
//  - 164/165: in page mode a typed text wraps at the page's edge, stays inside the page, and the
//    text box does not move while typing (it used to jump left and end up wider than the page).
//  - 162: the user's text defaults (font, size, colour, alignment) carry into headings, lists and
//    quotes; only the role's own look (size, weight, theme colour) changes.
//  - 163: the editor draws a heading in the active theme's heading colour, light and dark.
const textarea = "textarea.excalidraw-wysiwyg";
const editor = (page: Page) => page.locator(".vault-editor");

const withPrefs = (page: Page, prefs: Record<string, unknown>) =>
  page.addInitScript((p) => {
    localStorage.setItem("excalidraw-vault-preferences-v1", JSON.stringify(p));
  }, prefs);

const box = (page: Page) =>
  page.evaluate(() => {
    const r = document
      .querySelector("textarea.excalidraw-wysiwyg")!
      .getBoundingClientRect();
    return { l: r.left, t: r.top, w: r.width, h: r.height };
  });

const editorColor = (page: Page) =>
  page.evaluate(
    () =>
      getComputedStyle(document.querySelector("textarea.excalidraw-wysiwyg")!)
        .color,
  );

const rgbOfVar = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement("span");
    probe.style.color = getComputedStyle(document.documentElement)
      .getPropertyValue(n)
      .trim();
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, name);

const LONG =
  "- rule files come from client business documents and then some more words go past the page edge for sure, keep typing here ";

for (const markdown of [true, false]) {
  test(`page mode, Markdown ${
    markdown ? "on" : "off"
  }: a long line near the page's right edge wraps there and the text does not move while typing`, async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openVault(page);
    await seedAndOpen(page, "Note.excalidraw", { elements: [] });
    await runCommand(page, "Page mode: On");
    if (markdown) {
      await editor(page).getByTestId("markdown-chip").click();
    }
    const setup = (await live(page)).pageSetup!;
    await editor(page).getByTestId("toolbar-text").click();
    const at = await toClient(page, setup.width * 0.7, 200);
    await page.mouse.click(at.x, at.y);
    await expect(page.locator(textarea)).toBeFocused();

    const before = await live(page);
    const first = await box(page);
    let moved = "";
    for (const [i, ch] of [...LONG].entries()) {
      await page.keyboard.type(ch);
      const b = await box(page);
      // left and top never change: only width and height grow with the text
      if (Math.abs(b.l - first.l) > 0.5 || Math.abs(b.t - first.t) > 0.5) {
        moved += `key ${i} (${JSON.stringify(ch)}): ${JSON.stringify(
          first,
        )} -> ${JSON.stringify(b)}\n`;
      }
    }
    expect(moved, "the text box moved while typing").toBe("");
    const after = await live(page);
    expect(after.scrollX).toBeCloseTo(before.scrollX, 1);
    expect(after.scrollY).toBeCloseTo(before.scrollY, 1);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    const texts = (await readScene(page, "Note.excalidraw")).elements.filter(
      (e: any) => e.type === "text" && !e.isDeleted,
    );
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      expect(t.x, "left edge on the page").toBeGreaterThanOrEqual(-0.5);
      expect(t.x + t.width, "right edge on the page").toBeLessThanOrEqual(
        setup.width + 0.5,
      );
    }
    // it started where the user clicked, it was not pushed to the page's left side
    expect(texts[0].x).toBeGreaterThan(setup.width * 0.5);
    expect(errors).toEqual([]);
  });
}

const DEFAULTS = {
  font_family: 8,
  font_size: 28,
  stroke_color: "#e03131",
  text_align: "center",
};

test("text defaults (font, size, colour, alignment) carry into headings, lists and quotes; the heading is bigger, bold and in the theme's colour", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await withPrefs(page, {
    theme: "dark",
    colorTheme: "Nord",
    toolText: DEFAULTS,
  });
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await editor(page).getByTestId("markdown-chip").click();
  await editor(page).getByTestId("toolbar-text").click();
  const c = await canvasBox(page);
  await page.mouse.click(c.x + c.width * 0.4, c.y + c.height * 0.3);
  await expect(page.locator(textarea)).toBeFocused();
  await page.keyboard.type("# Head");

  // while editing, the heading is drawn in the theme's heading 1 colour, not the user's red
  const h1 = await rgbOfVar(page, "--vault-md-h1");
  expect(await editorColor(page)).toBe(h1);

  await page.keyboard.press("Enter");
  await page.keyboard.type("- item");
  await page.keyboard.press("Enter");
  await page.keyboard.type("next");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("> said");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  const texts = (await readScene(page, "DSA/Graphs.excalidraw")).elements
    .filter((e: any) => e.type === "text" && !e.isDeleted && e.x > 0)
    .slice(-3);
  const [head, list, quote] = texts;
  expect(head.customData).toMatchObject({ role: "h1", roleBase: "#e03131" });
  expect(quote.customData).toEqual({ role: "quote", roleBase: "#e03131" });
  expect(list.customData ?? null).toBeNull();
  for (const t of texts) {
    expect(t.strokeColor).toBe("#e03131");
    expect(t.textAlign).toBe("center");
    expect(t.fontFamily % 100).toBe(8); // Comic Shanns, regular or bold face
  }
  expect(head.fontSize).toBe(56);
  expect(head.fontFamily).toBe(108);
  expect(list.fontSize).toBe(28);
  expect(list.fontFamily).toBe(8);
  expect(quote.fontSize).toBe(28);
  expect(quote.fontFamily).toBe(8);
  expect(errors).toEqual([]);
});

const THEMES = [
  { color: "Default", theme: "light" },
  { color: "Nord", theme: "dark" },
  { color: "Gruvbox", theme: "dark" },
  { color: "Catppuccin", theme: "light" },
];
for (const t of THEMES) {
  test(`heading colour follows the ${t.color} theme (${t.theme})`, async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await withPrefs(page, { theme: t.theme, colorTheme: t.color });
    await openVault(page);
    await page
      .locator(".vault-tree-item__name", { hasText: "DSA" })
      .first()
      .click();
    await openDrawing(page, "Graphs");
    await editor(page).getByTestId("markdown-chip").click();
    await editor(page).getByTestId("toolbar-text").click();
    const c = await canvasBox(page);
    await page.mouse.click(c.x + c.width * 0.4, c.y + c.height * 0.3);
    await expect(page.locator(textarea)).toBeFocused();
    for (const level of [1, 2, 3]) {
      await page.keyboard.type(`${"#".repeat(level)} `);
      expect(await editorColor(page), `h${level}`).toBe(
        await rgbOfVar(page, `--vault-md-h${level}`),
      );
      await page.keyboard.press("Enter");
      await page.keyboard.press("Escape");
      await editor(page).getByTestId("toolbar-text").click();
      await page.mouse.click(
        c.x + c.width * 0.4,
        c.y + c.height * (0.3 + 0.2 * level),
      );
      await expect(page.locator(textarea)).toBeFocused();
    }
    expect(errors).toEqual([]);
  });
}
