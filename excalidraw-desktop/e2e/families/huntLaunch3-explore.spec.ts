import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { openVault } from "../helpers";

// Launch hunter 3 (2026-10-31): the day's merged note fixes (embedded task ticking 267, note
// property order 281, big-note lexer 288, word filters 246) used through visible UI on an
// Obsidian-shaped vault with odd content. Reference: Obsidian.

const outside = (page: Page, change: object) =>
  page.evaluate((c) => (window as any).__vaultRepo.outside(c), change);
const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);
const note = async (page: Page, path: string, text: string) => {
  await outside(page, { op: "create", path });
  await outside(page, { op: "modify", path, content: text });
};
const textOf = (page: Page, p: string) =>
  page.evaluate(
    (x) => (window as any).__noteFiles.textOf(x) as string | undefined,
    p,
  );

test.describe("launch hunter 3: notes after the day's fixes", () => {
  test.beforeEach(async ({ page }) => {
    await openVault(page, "?seed=obsidian");
    await note(
      page,
      "Plan.md",
      "---\nstatus: draft\naliases: [P]\n---\n# Plan\n\n```md\n- [ ] in a fence\n```\n\n- [ ] one\n- [ ] two\n",
    );
  });

  test("a task in a note embedded through a middle note is ticked in the right file", async ({
    page,
  }) => {
    await note(
      page,
      "Middle.md",
      "# Middle\n\n- [ ] middle task\n\n![[Plan]]\n",
    );
    await note(page, "Top.md", "# Top\n\n- [ ] top task\n\n![[Middle]]\n");
    await row(page, "Top.md").click();
    const reading = page.getByTestId("note-reading");
    await expect(reading.getByText("middle task")).toBeVisible();
    // The Plan embed inside the Middle embed: tick "two".
    const two = reading
      .locator("li", { hasText: /^\s*two\s*$/ })
      .locator("input");
    await expect(two).toBeVisible();
    await two.click();
    await expect
      .poll(() => textOf(page, "Plan.md"), { timeout: 4000 })
      .toContain("- [x] two");
    const plan = (await textOf(page, "Plan.md")) ?? "";
    expect(plan).toContain("- [ ] one");
    expect(plan).toContain("- [ ] in a fence");
    expect(plan.startsWith("---\nstatus: draft\naliases: [P]\n---\n")).toBe(
      true,
    );
    // The host and the middle note are untouched.
    expect(await textOf(page, "Top.md")).toContain("- [ ] top task");
    expect(await textOf(page, "Middle.md")).toContain("- [ ] middle task");
  });

  test("the same note embedded twice: ticking one box ticks the file once and untick works", async ({
    page,
  }) => {
    await note(page, "Twice.md", "# Twice\n\n![[Plan]]\n\n![[Plan]]\n");
    await row(page, "Twice.md").click();
    const reading = page.getByTestId("note-reading");
    const ones = reading
      .locator("li", { hasText: /^\s*one\s*$/ })
      .locator("input");
    await expect(ones).toHaveCount(2);
    await ones.nth(1).click();
    await expect
      .poll(() => textOf(page, "Plan.md"), { timeout: 4000 })
      .toContain("- [x] one");
    await ones.nth(1).click();
    await expect
      .poll(() => textOf(page, "Plan.md"), { timeout: 4000 })
      .toContain("- [ ] one");
  });

  test("ticking in the host after ticking in an embed still hits the right host line", async ({
    page,
  }) => {
    await note(
      page,
      "Host.md",
      "# Host\n\n![[Plan]]\n\n- [ ] host a\n- [ ] host b\n",
    );
    await row(page, "Host.md").click();
    const reading = page.getByTestId("note-reading");
    await reading
      .locator("li", { hasText: /^\s*one\s*$/ })
      .locator("input")
      .click();
    await expect
      .poll(() => textOf(page, "Plan.md"), { timeout: 4000 })
      .toContain("- [x] one");
    await reading
      .locator("li", { hasText: /^\s*host b\s*$/ })
      .locator("input")
      .click();
    await expect
      .poll(() => textOf(page, "Host.md"), { timeout: 4000 })
      .toContain("- [x] host b");
    const host = (await textOf(page, "Host.md")) ?? "";
    expect(host).toContain("- [ ] host a");
  });
});
