/**
 * Bug family (toimprove #61): every menu lays out cleanly: check and radio
 * marks never overlap labels, key hints and chevrons sit beside them, nothing
 * is clipped, and arrow keys move through the items. One table of menus x
 * three themes; add a menu with one row.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { openDrawing, openVault, trackErrors } from "../helpers";

const PREFS_KEY = "excalidraw-vault-preferences-v1";
const GRAPHS = "DSA/Graphs.excalidraw";

const THEMES = [
  { tag: "default-light", colorTheme: "Default", theme: "light" },
  { tag: "default-dark", colorTheme: "Default", theme: "dark" },
  { tag: "cendre-dark", colorTheme: "Cendre", theme: "dark" },
] as const;

interface Menu {
  name: string;
  /** Root selector of the open menu (the last match is the one measured). */
  root: string;
  /** At least this many marked (checked) items must be present. */
  marks: number;
  open: (page: Page) => Promise<void>;
}

const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

const MENUS: Menu[] = [
  {
    name: "main menu",
    root: ".dropdown-menu",
    marks: 0,
    open: async (page) => {
      await page.getByTestId("main-menu-trigger").click();
    },
  },
  {
    name: "canvas context menu",
    root: ".context-menu",
    marks: 1,
    open: async (page) => {
      const box = await page.locator("canvas.interactive").boundingBox();
      await page.mouse.click(box!.x + box!.width - 60, box!.y + 90, {
        button: "right",
      });
    },
  },
  {
    name: "navigator sort menu",
    root: ".vault-menu",
    marks: 1,
    open: async (page) => {
      await page.getByRole("button", { name: "Sort order" }).click();
    },
  },
  {
    name: "folder row menu",
    root: ".vault-menu",
    marks: 0,
    open: async (page) => {
      await row(page, "DSA").click({ button: "right" });
    },
  },
  {
    name: "drawing row menu (with submenu)",
    root: ".vault-menu",
    marks: 0,
    open: async (page) => {
      await row(page, GRAPHS).click({ button: "right" });
      await page.getByRole("menuitem", { name: "Export" }).hover();
    },
  },
];

/** Measured in the page: returns a list of human-readable violations. */
const measure = (page: Page, rootSelector: string) =>
  page.evaluate((sel) => {
    const roots = Array.from(document.querySelectorAll<HTMLElement>(sel));
    const menus = roots.filter((r) => r.getBoundingClientRect().width > 0);
    const problems: string[] = [];
    let marked = 0;
    const hit = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 1 &&
      b.left < a.right - 1 &&
      a.top < b.bottom - 1 &&
      b.top < a.bottom - 1;
    const textRect = (el: Element) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect();
    };
    const ITEM =
      "[role^='menuitem'], .context-menu-item, .dropdown-menu-item-base";
    for (const menu of menus) {
      const mbox = menu.getBoundingClientRect();
      if (
        mbox.left < 0 ||
        mbox.top < 0 ||
        mbox.right > innerWidth + 1 ||
        mbox.bottom > innerHeight + 1
      ) {
        problems.push(`menu clipped by the window: ${sel}`);
      }
      for (const item of menu.querySelectorAll<HTMLElement>(ITEM)) {
        if (
          item.closest("[role='menu'], .dropdown-menu, .context-menu") !== menu
        ) {
          continue;
        }
        const ibox = item.getBoundingClientRect();
        if (ibox.width === 0) {
          continue;
        }
        const label =
          item.querySelector<HTMLElement>(
            ".vault-menu__label, .dropdown-menu-item__text, .context-menu-item__label",
          ) ?? item;
        const name = (label.textContent ?? "").trim().slice(0, 30);
        const lbox = textRect(label);
        if (lbox.left < ibox.left - 1 || lbox.right > ibox.right + 1) {
          problems.push(`label outside its item: ${name}`);
        }
        if (label.scrollWidth > label.clientWidth + 1 && label !== item) {
          problems.push(`label truncated: ${name}`);
        }
        const marks = Array.from(
          item.querySelectorAll<Element>(
            ".vault-menu__check, .vault-menu__chevron, .vault-menu__hint, .dropdown-menu-item__icon svg, .dropdown-menu-item__shortcut, .context-menu-item__shortcut",
          ),
        );
        const checked =
          item.getAttribute("aria-checked") === "true" ||
          item.classList.contains("checkmark") ||
          !!item.querySelector(".vault-menu__check");
        if (checked) {
          marked++;
        }
        for (const mark of marks) {
          const b = mark.getBoundingClientRect();
          if (b.width > 0 && hit(b, lbox)) {
            problems.push(
              `${
                mark.className.baseVal ?? mark.className
              } overlaps label: ${name}`,
            );
          }
        }
        if (item.classList.contains("checkmark")) {
          // The check is a ::before glyph: it must end before the label starts.
          const before = getComputedStyle(item, "::before");
          const glyphEnd =
            parseFloat(before.left) + parseFloat(before.fontSize) * 0.9;
          if (lbox.left - ibox.left < glyphEnd) {
            problems.push(`check glyph over label: ${name}`);
          }
        }
      }
    }
    return { problems, marked, menus: menus.length };
  }, rootSelector);

for (const theme of THEMES) {
  test(`menus lay out cleanly in ${theme.tag}`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.addInitScript(
      ([key, value]) => {
        if (!window.sessionStorage.getItem("menus-seeded")) {
          window.localStorage.setItem(key as string, JSON.stringify(value));
          window.sessionStorage.setItem("menus-seeded", "1");
        }
      },
      [
        PREFS_KEY,
        { colorTheme: theme.colorTheme, theme: theme.theme },
      ] as const,
    );
    await openVault(page);
    await page
      .locator(".vault-tree-item__name", { hasText: "DSA" })
      .first()
      .click();
    await openDrawing(page, "Graphs");

    for (const menu of MENUS) {
      await menu.open(page);
      await expect(page.locator(menu.root).last()).toBeVisible();
      const { problems, marked, menus } = await measure(page, menu.root);
      expect(menus, `${menu.name}: a menu is open`).toBeGreaterThan(0);
      expect(problems, `${menu.name} in ${theme.tag}`).toEqual([]);
      expect(marked, `${menu.name}: marked items`).toBeGreaterThanOrEqual(
        menu.marks,
      );
      // Keyboard: ArrowDown moves focus off the first item (menus that take focus).
      if (menu.root === ".vault-menu") {
        const first = await page.evaluate(
          () => document.activeElement?.textContent ?? "",
        );
        await page.keyboard.press("ArrowDown");
        const second = await page.evaluate(
          () => document.activeElement?.textContent ?? "",
        );
        expect(second, `${menu.name}: arrow keys move`).not.toBe(first);
      }
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      if (await page.locator(menu.root).last().isVisible()) {
        // Excalidraw's canvas menu closes on an outside click, not Escape.
        await page.mouse.click(2, 2);
      }
      await expect(page.locator(menu.root).last()).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}
