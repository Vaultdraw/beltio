import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { openDrawing, openVault, trackErrors } from "../helpers";
import { focusCanvas } from "../pageHelpers";

// Hunter B round 4: library items with odd names inserted by name from the palette, renamed,
// removed; the palette follows the library.
const base = {
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  boundElements: null,
  link: null,
  locked: false,
  isDeleted: false,
  version: 1,
  versionNonce: 1,
  updated: 1,
};
const item = (id: string, name: string, n = 1) => ({
  id,
  status: "unpublished",
  created: 1,
  name,
  elements: Array.from({ length: n }, (_, i) => ({
    ...base,
    id: `${id}-r${i}`,
    type: "rectangle",
    x: i * 120,
    y: 0,
    width: 100,
    height: 60,
    seed: 1 + i,
  })),
});
const LONG = "Quarterly planning board with every swimlane ".repeat(4).trim();
const ITEMS = [
  item("a", "Box"),
  item("b", "Box", 2),
  item("c", "🌲 Tree ünï", 3),
  item("d", LONG),
  item("e", "  padded  "),
];
const palette = (p: Page) => p.getByRole("dialog", { name: "Command palette" });
const live = (p: Page) =>
  p.evaluate(
    () =>
      (window as any)
        .__editorApis()[0]
        .getSceneElements()
        .filter((e: any) => !e.isDeleted).length as number,
  );
const entries = async (p: Page, q: string) => {
  await p.keyboard.press("Escape");
  await p.keyboard.press("Meta+Shift+KeyP");
  await expect(palette(p)).toBeVisible();
  await p.keyboard.type(q);
  await p.waitForTimeout(250);
  const t = await palette(p).getByRole("option").allTextContents();
  return t.map((s) => s.trim());
};

test("hunter B: palette 'Insert:' entries for odd library names insert the right item and follow rename and remove", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page.evaluate(
    (items) =>
      (window as any).__libraryRepo.setFile(
        "personal",
        JSON.stringify({
          type: "excalidrawlib",
          version: 2,
          source: "https://excalidraw.com",
          libraryItems: items,
        }),
      ),
    ITEMS,
  );
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await focusCanvas(page);
  const start = await live(page);
  await expect(async () => {
    const e = await entries(page, "Insert: Box");
    expect(e.filter((x) => x.includes("Insert: Box")).length).toBe(2);
  }).toPass({ timeout: 10_000 });
  expect(await entries(page, "tree")).toContain("Insert: 🌲 Tree ünï");
  expect(await entries(page, "unï")).toContain("Insert: 🌲 Tree ünï");
  expect(await entries(page, "padded")).toContain("Insert: padded");
  // a very long name must stay inside the palette (ellipsis, no horizontal overflow)
  await entries(page, "swimlane");
  const row = palette(page).getByRole("option").first();
  const rb = (await row.boundingBox())!;
  const pb = (await palette(page).boundingBox())!;
  expect(rb.x + rb.width).toBeLessThanOrEqual(pb.x + pb.width + 1);
  const scrolls = await row.evaluate((el) => {
    let e: HTMLElement | null = el as HTMLElement;
    while (e && e.getAttribute("role") !== "dialog") {
      if (
        e.scrollWidth > e.clientWidth + 1 &&
        getComputedStyle(e).overflowX === "visible"
      ) {
        return true;
      }
      e = e.parentElement;
    }
    return false;
  });
  expect(scrolls, "a row's text overflows its box").toBe(false);
  // insert the 3-element item by name
  await entries(page, "🌲");
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect.poll(() => live(page)).toBe(start + 3);
  // rename in the sidebar: the palette lists the new name only; remove: the entry is gone
  await page.keyboard.press("Escape");
  await page.locator(".default-sidebar-trigger").first().click();
  const tile = (id: string) => page.getByTestId(`library-unit-${id}`);
  await tile("a").getByTestId("library-item-name").dblclick();
  const input = page.getByTestId("library-item-name-input");
  await input.fill("Crate");
  await input.press("Enter");
  await tile("e").click({ modifiers: ["Shift"] });
  await page
    .locator(
      ".library-menu-dropdown-container [data-testid='dropdown-menu-button']",
    )
    .first()
    .click();
  await page
    .locator(".library-menu .dropdown-menu-item")
    .filter({ hasText: /^Remove/ })
    .click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page
    .locator(".default-sidebar")
    .getByRole("button", { name: "Close" })
    .click();
  await expect(async () => {
    const crate = await entries(page, "Insert: Crate");
    expect(crate.some((x) => x === "Insert: Crate")).toBe(true);
    const box = await entries(page, "Insert: Box");
    expect(box.filter((x) => x === "Insert: Box").length).toBe(1);
    const pad = await entries(page, "padded");
    expect(pad.some((x) => x === "Insert: padded")).toBe(false);
  }).toPass({ timeout: 10_000 });
  expect(errors).toEqual([]);
});
