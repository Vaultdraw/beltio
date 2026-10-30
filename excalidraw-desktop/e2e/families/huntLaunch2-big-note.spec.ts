import { expect } from "@playwright/test";

import { test } from "../fixture";
import { openVault } from "../helpers";

// Launch hunter 2 [launch] [notes], toimprove 288: opening a 1 MB note freezes the window. The
// reading view's lexer is quadratic (src/notes/huntLaunch2BigNote.test.ts). Obsidian opens it at
// once. Measured: the longest gap between two frames was 6 s (load average 8 to 13).
test("toimprove 288: opening a 1 MB note never freezes the window for more than 2 s", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openVault(page, "?seed=obsidian");
  const parts: string[] = ["# Big log\n"];
  let len = 0;
  for (let n = 0; len < 1000 * 1024; n++) {
    const s = `## Entry ${n}\n\n- [ ] task ${n} with **bold** and [[Welcome]]\n- item two\n\nParagraph ${n} lorem ipsum dolor sit amet.\n`;
    parts.push(s);
    len += s.length;
  }
  await page.evaluate((text) => {
    const r = (window as any).__vaultRepo;
    r.outside({ op: "create", path: "Big.md" });
    r.outside({ op: "modify", path: "Big.md", content: text });
  }, parts.join("\n"));
  await page.evaluate(() => {
    (window as any).__gap = 0;
    let last = performance.now();
    const f = () => {
      const n = performance.now();
      (window as any).__gap = Math.max((window as any).__gap, n - last);
      last = n;
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  await page.locator('[data-tree-path="Big.md"]').click();
  await expect(
    page.getByTestId("note-reading").getByRole("heading", { level: 1 }),
  ).toBeVisible({ timeout: 120_000 });
  const gap = await page.evaluate(() => (window as any).__gap as number);
  expect(gap).toBeLessThan(2000);
});
