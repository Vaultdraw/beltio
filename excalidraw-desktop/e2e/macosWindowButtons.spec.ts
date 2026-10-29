import { expect } from "@playwright/test";

import { test } from "./fixture";
import { openDrawing, openVault } from "./helpers";
import { runPaletteCommand } from "./historyHelpers";

// macOS draws its window buttons over the top-left of the window (overlay
// title bar). With the header hidden, nothing clickable may sit under them.
const BUTTONS = { right: 80, bottom: 28 };

const EMPTY = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "e2e",
  elements: [],
  appState: {},
  files: {},
});

test("header hidden on macOS: nothing under the window buttons", async ({
  page,
}) => {
  await openVault(page);
  await page.evaluate(() =>
    document.documentElement.classList.add("vault-macos"),
  );
  await page.evaluate(
    (json) => (window as any).__vaultRepo.seedDrawing("Board.excalidraw", json),
    EMPTY,
  );
  await page
    .getByRole("button", { name: /Refresh/i })
    .first()
    .click();
  await openDrawing(page, "Board");
  await runPaletteCommand(page, "Layout: Toggle header");
  await expect(page.locator(".vault-header")).toHaveCount(0);

  const hits = await page.evaluate(({ right, bottom }) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(
      "button, a, [role=button], input",
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        continue;
      }
      if (r.left < right && r.top < bottom) {
        out.push(el.getAttribute("aria-label") || el.className || el.tagName);
      }
    }
    return out;
  }, BUTTONS);
  expect(hits, "controls under the window buttons").toEqual([]);
});
