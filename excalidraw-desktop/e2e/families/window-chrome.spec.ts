import { expect } from "@playwright/test";

import { test } from "../fixture";
import { openDrawing, openVault } from "../helpers";
import { runPaletteCommand } from "../historyHelpers";

/**
 * Family (hunter B-4): "hiding a layout part never removes the window's own controls".
 * Linux custom chrome (`[window] decorations = "custom"`, the Linux default) draws no system
 * title bar: the app's header carries the window buttons and the drag area. In every layout
 * state the three buttons and a drag area must stay reachable by mouse.
 */
const EMPTY = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "e2e",
  elements: [],
  appState: {},
  files: {},
});

const STATES: { name: string; enter: string[] }[] = [
  { name: "header shown", enter: [] },
  { name: "header hidden", enter: ["Layout: Toggle header"] },
  { name: "focus mode", enter: ["View: Focus mode"] },
];

for (const state of STATES) {
  test(`custom window chrome, ${state.name}: window buttons and drag area stay`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as any).__VAULTDRAW_CHROME__ = "custom";
    });
    await openVault(page);
    await page.evaluate(() =>
      document.documentElement.classList.add("vault-linux-custom"),
    );
    await page.evaluate(
      (json) =>
        (window as any).__vaultRepo.seedDrawing("Board.excalidraw", json),
      EMPTY,
    );
    await page
      .getByRole("button", { name: /Refresh/i })
      .first()
      .click();
    await openDrawing(page, "Board");
    for (const command of state.enter) {
      await runPaletteCommand(page, command);
    }
    for (const name of ["Minimize window", "Maximize window", "Close window"]) {
      await expect(page.getByRole("button", { name })).toBeVisible();
    }
    const drag = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[data-tauri-drag-region]")]
        .map((el) => el.getBoundingClientRect())
        .some((r) => r.width > 100 && r.height >= 20 && r.top < 60),
    );
    expect(drag, "a drag area along the top").toBe(true);
  });
}
