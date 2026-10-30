import { expect } from "@playwright/test";

import { test } from "../fixture";

import { openVault, trackErrors } from "../helpers";

// Hunter D round 2 (finding D-1): the About page's "Check for updates" button was white text on a
// transparent background (the Settings rule `.vault-settings-modal .vault-btn` wiped the primary
// fill), so it looked like an empty box in every theme, light and dark. Family: every primary
// (filled) button inside the Settings modal keeps its fill and reads against it.
for (const scheme of ["light", "dark"] as const) {
  test(`every primary button in Settings has a visible fill (${scheme})`, async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.emulateMedia({ colorScheme: scheme });
    await openVault(page);
    await page.keyboard.press("Meta+Comma");
    const d = page.locator(".vault-settings-modal");
    await expect(d).toBeVisible();
    const tabs = await d
      .getByRole("tab")
      .evaluateAll((els) => els.map((e) => (e.textContent || "").trim()));
    let seen = 0;
    for (const tab of tabs) {
      await d.getByRole("tab", { name: tab, exact: true }).click();
      const bad = await page.evaluate(() => {
        const out: string[] = [];
        let n = 0;
        for (const b of document.querySelectorAll<HTMLElement>(
          ".vault-settings-modal .vault-btn--primary",
        )) {
          n++;
          const cs = getComputedStyle(b);
          const m = cs.backgroundColor.match(/[\d.]+/g) ?? [];
          const alpha = m.length > 3 ? Number(m[3]) : 1;
          if (alpha < 0.5 || cs.backgroundColor === cs.color) {
            out.push(
              `${b.textContent} bg ${cs.backgroundColor} text ${cs.color}`,
            );
          }
        }
        return { out, n };
      });
      seen += bad.n;
      expect(bad.out, tab).toEqual([]);
    }
    expect(seen).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}
