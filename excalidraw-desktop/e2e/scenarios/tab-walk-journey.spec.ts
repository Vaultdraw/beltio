import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { openDrawing, openVault } from "../helpers";

import { stepProblems } from "./checks";
import { journey } from "./journey";

// Journey: walk the whole window with the Tab key. Safari-family engines skip buttons when Tab is
// pressed unless the user turns that on, so this runs in Chromium, where Tab reaches every control
// (the Tauri window on Linux and Windows is Chromium-based; macOS users get the same order with
// "Press Tab to highlight each item" on). At every stop the focus must be visible, never on
// something hidden, and a dialog must keep Tab inside itself.

test.use({ browserName: "chromium" });

type Stop = { key: string; problems: string[] };

const walk = async (page: Page, presses: number, shift = false) => {
  const stops: Stop[] = [];
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(shift ? "Shift+Tab" : "Tab");
    const key = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === document.body) {
        return "(page)";
      }
      return `${a.tagName.toLowerCase()}:${
        a.getAttribute("aria-label") ||
        a.innerText?.replace(/\s+/g, " ").slice(0, 24) ||
        a.className
      }`;
    });
    const problems = (
      await stepProblems(page, { dialogs: undefined as never })
    ).filter((p) => /focus/.test(p));
    stops.push({ key, problems });
  }
  return stops;
};

const report = (stops: Stop[], where: string, say: (p: string) => void) => {
  for (const s of stops) {
    for (const p of s.problems) {
      say(`${where}: Tab stop "${s.key}": ${p}`);
    }
  }
};

journey({
  title: "tab-walk-journey",
  known: [
    {
      match: /Tab is trapped in the editor/,
      bug: "toimprove TN-5: Tab cannot leave the canvas",
    },
    {
      match: /vault-stepper__value\)" has keyboard focus without/,
      bug: "toimprove TN-8: a number stepper in Settings shows no focus ring",
    },
  ],
  setup: async (page) => {
    await openVault(page);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
  },
  steps: [
    {
      name: "home screen: Tab reaches the search box, the file list, the tabs and the buttons",
      keyboard: true,
      run: async (page, ctx) => {
        const stops = await walk(page, 30);
        report(stops, "home screen", ctx.report);
        const distinct = new Set(stops.map((s) => s.key));
        expect(distinct.size, [...distinct].join(" | ")).toBeGreaterThan(8);
        // Not stuck on the page body at any stop.
        expect(stops.filter((s) => s.key === "(page)").length).toBeLessThan(4);
      },
    },
    {
      name: "with a drawing open: Tab leaves the canvas and walks the header and navigator",
      keyboard: true,
      run: async (page, ctx) => {
        await page
          .locator(".vault-tree-item__name", { hasText: /^DSA$/ })
          .first()
          .click();
        await openDrawing(page, "Graphs");
        const stops = await walk(page, 30);
        report(stops, "drawing open", ctx.report);
        const keys = new Set(stops.map((s) => s.key));
        if (keys.size < 3) {
          ctx.report(
            `Tab is trapped in the editor: 30 presses reached only ${[
              ...keys,
            ].join(" | ")}`,
          );
        }
      },
    },
    {
      name: "Settings: Tab stays inside the dialog and every stop shows its focus",
      keyboard: true,
      check: { dialogs: 1 },
      run: async (page, ctx) => {
        await page
          .getByLabel("Vault file navigator")
          .getByRole("button", { name: "Settings" })
          .click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const stops = await walk(page, 40);
        report(stops, "Settings", ctx.report);
        const outside = await page.evaluate(() => {
          const a = document.activeElement as HTMLElement | null;
          return a?.closest('[role="dialog"]')
            ? ""
            : `${a?.tagName}.${a?.className} "${
                a?.getAttribute("aria-label") ?? a?.innerText?.slice(0, 30)
              }"`;
        });
        if (outside) {
          ctx.report(
            `Tab leaves the Settings dialog and lands behind it on ${outside}`,
          );
        }
      },
    },
    {
      name: "Escape closes Settings and the focus goes back to a usable place",
      keyboard: true,
      run: async (page, ctx) => {
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        const lost = await page.evaluate(
          () => document.activeElement === document.body,
        );
        if (lost) {
          ctx.report(
            "after Escape closes Settings the keyboard focus is lost on the page body",
          );
        }
      },
    },
  ],
});
