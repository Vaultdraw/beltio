import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { openDrawing, openVault, trackErrors } from "../helpers";
import { live, runCommand } from "../pageHelpers";

/**
 * Family (bug utilizer sweep, 2026-10-30; COVERAGE.md listed extension switches as untested):
 * "turning a built-in extension off and on again" for every extension. Like Obsidian's core
 * plugins: off takes its buttons away without errors, the drawing stays as it was, the switch
 * stays reachable from the palette, and on brings back exactly what was there.
 */
const EXTENSIONS = [
  "Full-text search",
  "Links",
  "Tags",
  "Graph view",
  "Library",
  "Templates",
  "History panel",
  "Formulas",
  "Mermaid to Excalidraw",
  "PDF import",
  "Markdown notes",
];

const surface = (page: Page) =>
  page.evaluate(() => ({
    bar: [...document.querySelectorAll("[data-testid^='activity-bar-']")]
      .map((e) => e.getAttribute("data-testid"))
      .sort(),
    header: [...document.querySelectorAll(".vault-header button")]
      .map((e) => e.getAttribute("aria-label") ?? e.textContent?.trim())
      .sort(),
  }));

for (const title of EXTENSIONS) {
  test(`extension "${title}": off and on again`, async ({ page }) => {
    const errors = trackErrors(page);
    await openVault(page);
    await page
      .locator(".vault-tree-item__name", { hasText: "DSA" })
      .first()
      .click();
    await openDrawing(page, "Graphs");
    const before = await surface(page);
    const elements = (await live(page)).elements.length;

    await runCommand(page, `Extensions: Toggle ${title}`);
    // The drawing is untouched and the switch is still offered to turn it back on.
    expect((await live(page)).elements.length).toBe(elements);
    await runCommand(page, `Extensions: Toggle ${title}`);

    await expect.poll(() => surface(page)).toEqual(before);
    expect((await live(page)).elements.length).toBe(elements);
    expect(errors).toEqual([]);
  });
}
