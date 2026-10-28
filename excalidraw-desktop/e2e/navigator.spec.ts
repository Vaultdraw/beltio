import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault, trackErrors } from "./helpers";

test("navigator can be resized and remembers its width", async ({ page }) => {
  const errors = trackErrors(page);
  await openVault(page);
  const nav = page.getByLabel("Vault file navigator");
  const before = (await nav.boundingBox())!.width;
  const handle = page.getByRole("separator", { name: "Resize navigator" });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 80, box.y + 200, { steps: 8 });
  await page.mouse.up();
  const after = (await nav.boundingBox())!.width;
  expect(after).toBeGreaterThan(before + 60);

  // Persisted for the next launch. (A page reload is avoided: WebKit cancels
  // Vite's unbundled dev-module requests on reload, a dev-server artifact.)
  await expect
    .poll(() =>
      page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) {
          const raw = localStorage.getItem(localStorage.key(i)!) ?? "";
          if (raw.includes("navigatorWidth")) {
            return JSON.parse(raw).navigatorWidth;
          }
        }
        return null;
      }),
    )
    .toBeCloseTo(after, -1);
  expect(errors).toEqual([]);
});

test("navigator collapse toggle hides and restores the tree", async ({
  page,
}) => {
  await openVault(page);
  // One toggle only (#47): the header button; the pane has no collapse button.
  await expect(
    page
      .getByLabel("Vault file navigator")
      .getByRole("button", { name: /Collapse Navigator|Hide navigator/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^(Hide|Show) Navigator$/ }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Hide navigator" }).click();
  await expect
    .poll(
      async () =>
        (
          await page
            .getByLabel("Vault file navigator", { exact: true })
            .boundingBox()
        )?.width ?? 0,
    )
    .toBeLessThan(2);
  await page.getByRole("button", { name: "Show navigator" }).click();
  await expect(page.locator(".vault-tree-item").first()).toBeVisible();
});

test("vault home lists recent drawings and opens them", async ({ page }) => {
  const errors = trackErrors(page);
  await openVault(page);
  const recent = page.getByRole("region", { name: "Recent drawings" });
  await expect(recent.getByRole("button")).toHaveCount(2);
  await recent.getByRole("button", { name: /Graphs/ }).click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await expect(page.getByLabel("Breadcrumb")).toContainText("Graphs");
  expect(errors).toEqual([]);
});

test("vault home actions show live shortcuts and run their commands", async ({
  page,
}) => {
  await openVault(page);
  const home = page.locator(".vault-home");
  await expect(home.locator(".vault-home__action")).toHaveCount(4);
  await expect(home.getByRole("button", { name: /New drawing/ })).toContainText(
    /N$/,
  );
  await home.getByRole("button", { name: /Show all commands/ }).focus();
  await page.keyboard.press("Enter");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette.getByRole("combobox")).toHaveValue(">");
});

// Perf guard (D16, D17, perf-redesign-fix P1): the first monospace text on the
// vault-open path costs a cold font-fallback layout (+15-20 ms at 4x throttle).
// <kbd>/<code> get `font-family: monospace` from the UA stylesheet, so every
// chip must set its font explicitly.
const monoTextIn = (page: import("@playwright/test").Page, selector: string) =>
  page.evaluate((sel) => {
    const mono = /monospace|menlo|monaco|consolas|sfmono|courier/i;
    const hits: string[] = [];
    for (const el of Array.from(document.querySelectorAll(`${sel} *`))) {
      const hasText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
      );
      if (hasText && mono.test(getComputedStyle(el).fontFamily)) {
        hits.push(`${el.tagName.toLowerCase()}.${el.className}`);
      }
    }
    return hits;
  }, selector);

test("vault open and the palette render no monospace text", async ({
  page,
}) => {
  await openVault(page);
  await expect(page.locator(".vault-home .vault-kbd").first()).toBeVisible();
  expect(await monoTextIn(page, "#root")).toEqual([]);
  await page.keyboard.press("Meta+KeyP");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette.locator(".vault-kbd").first()).toBeVisible();
  expect(await monoTextIn(page, "body")).toEqual([]);
});

test("pan hint and canvas menus render no monospace text", async ({ page }) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await expect(
    page.locator(".excalidraw .HintViewer kbd").first(),
  ).toBeVisible();
  expect(await monoTextIn(page, ".excalidraw .HintViewer")).toEqual([]);
  await page.getByTestId("main-menu-trigger").click();
  await expect(
    page.locator(".excalidraw .dropdown-menu-item__shortcut").first(),
  ).toBeVisible();
  expect(await monoTextIn(page, ".excalidraw .dropdown-menu")).toEqual([]);
  await page.keyboard.press("Escape");
  const canvas = page.locator(".vault-editor canvas.interactive");
  await canvas.click({ button: "right", position: { x: 600, y: 500 } });
  await expect(
    page.locator(".excalidraw .context-menu-item__shortcut").first(),
  ).toBeVisible();
  expect(await monoTextIn(page, ".excalidraw .context-menu")).toEqual([]);
});
