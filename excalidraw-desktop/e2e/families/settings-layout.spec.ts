import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "../fixture";

import { openVault, trackErrors } from "../helpers";

// Family: a Settings row with a long value or several buttons lays out cleanly.
// Every Settings page, at a wide and a narrow window: no text sticking out of
// its box, no label overlapping its buttons, no path broken in the middle of
// a word, and the Config File row reads as one line of text + buttons (wide)
// with full-width file rows and Open buttons in one column.
const WIDTHS = [
  { name: "wide", width: 1500, height: 900 },
  { name: "narrow", width: 700, height: 900 },
] as const;

const LONG =
  "/Users/someone-with-a-long-name/dotfiles/vaultdraw/shared/colors-and-fonts.toml";

type Box = { x: number; y: number; w: number; h: number };

/** Problems found on the open page of the Settings dialog, as readable strings. */
const audit = (dialog: Locator) =>
  dialog.evaluate((root) => {
    const problems: string[] = [];
    const rect = (e: Element) => e.getBoundingClientRect();
    const name = (e: Element) =>
      `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} "${(
        e.textContent ?? ""
      )
        .trim()
        .slice(0, 40)}"`;
    const rootRect = rect(root);
    // 1. Text that does not fit its box (unless it deliberately shortens with an ellipsis).
    for (const e of root.querySelectorAll<HTMLElement>(
      "button, label, code, .vault-setting-label, .vault-setting-desc, .vault-config-layer span",
    )) {
      const r = rect(e);
      if (r.width <= 2 || r.height <= 2) {
        continue;
      }
      const cs = getComputedStyle(e);
      const clipped =
        cs.textOverflow === "ellipsis" || cs.overflow !== "visible";
      if (
        !clipped &&
        e.scrollWidth > e.clientWidth + 1 &&
        cs.display !== "inline"
      ) {
        problems.push(`overflows its box: ${name(e)}`);
      }
      if (r.right > rootRect.right + 1) {
        problems.push(`sticks out of the dialog: ${name(e)}`);
      }
    }
    // 2. A row's text and its controls never overlap.
    for (const row of root.querySelectorAll(
      ".vault-setting-row, .vault-setting-block",
    )) {
      const parts = [
        ...row.querySelectorAll(
          ":scope > .vault-setting-info, :scope > .vault-setting-control, :scope > .vault-setting-below",
        ),
      ].map((e) => rect(e));
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i];
          const b = parts[j];
          const overlap =
            a.left < b.right - 1 &&
            b.left < a.right - 1 &&
            a.top < b.bottom - 1 &&
            b.top < a.bottom - 1;
          if (overlap && a.width > 0 && b.width > 0) {
            problems.push(
              `parts overlap in row ${row.getAttribute("data-setting-id")}`,
            );
          }
        }
      }
    }
    // 3. A path stays on one line and its file name is fully visible.
    for (const code of root.querySelectorAll(".vault-config-path")) {
      const file = code.querySelector(".vault-config-path__file");
      const c = rect(code);
      if (file) {
        const f = rect(file);
        if (f.right > c.right + 1 || f.height > c.height + 1) {
          problems.push(`path file name is cut: ${name(code)}`);
        }
      }
      if (
        rect(code).height >
        parseFloat(getComputedStyle(code).lineHeight || "24") * 1.6
      ) {
        problems.push(`path wraps: ${name(code)}`);
      }
    }
    return problems;
  });

const box = async (l: Locator): Promise<Box> => {
  const b = (await l.boundingBox())!;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
};

const openSettings = async (page: Page) => {
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  return page.getByRole("dialog");
};

test("every Settings page lays out cleanly at a wide and a narrow window", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.addInitScript((long) => {
    (window as any).__e2eConfig = { include: { files: ["colors.toml"] } };
    (window as any).__e2eIncludes = [
      {
        name: "colors-and-fonts.toml",
        path: long,
        config: { interface: { thumbnails: false } },
      },
      { name: "gone.toml", path: "/e2e/dots/gone.toml", config: null },
    ];
  }, LONG);
  await openVault(page, "?config=1");

  for (const size of WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    const dialog = await openSettings(page);
    const tabs = await dialog.getByRole("tab").allTextContents();
    expect(tabs.length).toBeGreaterThan(5);
    for (const label of tabs) {
      await dialog.getByRole("tab", { name: label, exact: true }).click();
      const found = await audit(dialog);
      expect(found, `${size.name} window, page ${label}`).toEqual([]);
    }

    // The Config File row (General).
    await dialog.getByRole("tab", { name: "General", exact: true }).click();
    const row = dialog.getByTestId("settings-config-row");
    const files = row.getByRole("list", { name: "Config files", exact: true });
    await expect(files.getByRole("listitem")).toHaveCount(4);
    const rowBox = await box(row);
    const filesBox = await box(files);
    // File rows use the full width of the row, not a squeezed column.
    expect(filesBox.w, `${size.name}: file rows full width`).toBeGreaterThan(
      rowBox.w * 0.85,
    );
    // The Open buttons sit in one column, same width.
    const opens = await files.getByRole("button", { name: /^Open / }).all();
    const boxes = await Promise.all(opens.map(box));
    for (const b of boxes) {
      expect(
        Math.abs(b.x - boxes[0].x),
        `${size.name}: Open buttons aligned`,
      ).toBeLessThan(1.5);
      expect(Math.abs(b.w - boxes[0].w)).toBeLessThan(1.5);
    }
    // Wide: the description and the buttons share a line. Narrow: buttons drop under the text.
    const desc = await box(row.locator(".vault-setting-desc"));
    const actions = await box(row.locator(".vault-config-actions"));
    if (size.name === "wide") {
      expect(actions.x).toBeGreaterThan(desc.x + desc.w - 2);
      expect(actions.y).toBeLessThan(desc.y + desc.h);
    } else {
      expect(actions.y).toBeGreaterThanOrEqual(desc.y + desc.h - 1);
    }
    // The long path keeps its file name and offers the full path on hover.
    const longPath = files.locator(".vault-config-path").first();
    await expect(longPath).toHaveAttribute("title", LONG);
    await expect(longPath.locator(".vault-config-path__file")).toHaveText(
      "colors-and-fonts.toml",
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
  expect(errors).toEqual([]);
});
