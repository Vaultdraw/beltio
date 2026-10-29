import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { openDrawing, openVault } from "../helpers";

// Family (hunter B, 2026-10-30): the window stays responsive whatever runs before. "Open another
// vault" (choosing the vault already open), a page size change and "Tabs: Close tab" froze the
// window: the tab controller retried a failing close in a microtask loop (100% CPU, memory
// climbing). Each row runs one palette command; after each, the page must answer within 5 s.

const COMMANDS = [
  "Open another vault",
  "Page size: A3",
  "Tabs: Close tab",
  "New drawing",
  "Page size: A4",
  "Tool: Rectangle",
  "Select all",
  "Tabs: New tab",
  "Open another vault",
  "Tabs: Close all tabs",
  "Go to drawing",
  "Open settings",
  "Tabs: Close tab",
];

const palette = (p: Page) => p.getByRole("dialog", { name: "Command palette" });

const within = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms),
    ),
  ]);

test("vault switch, then a run of commands: the window keeps answering", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  for (const title of COMMANDS) {
    await within(
      (async () => {
        await page.keyboard.press("Meta+Shift+KeyP");
        await palette(page).getByRole("combobox").fill(`>${title}`);
        await palette(page)
          .getByRole("option")
          .filter({ hasText: title })
          .first()
          .click({ timeout: 3000 })
          .catch(() => undefined); // not available in this state: fine
        for (let i = 0; i < 3; i++) {
          await page.keyboard.press("Escape");
        }
      })(),
      15_000,
    ).catch((e) => {
      throw new Error(`after "${title}": ${String(e)}`);
    });
    const answer = await within(
      page.evaluate(() => document.readyState),
      5_000,
    ).catch(() => "frozen");
    expect(answer, `the window answers after "${title}"`).toBe("complete");
  }
});
