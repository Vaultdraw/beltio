import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { openVault, trackErrors } from "../helpers";

// Hunter L (2026-10-30 night) [notes]: the evening's reading-view work (embeds, footnotes,
// callout titles, custom task statuses, property links, %% comments) used through visible UI on an
// Obsidian-shaped vault with odd content: unicode and long names, nested folders, the same name in
// two folders, a note and a drawing with the same name. Reference: Obsidian's reading view.

const outside = (page: Page, change: object) =>
  page.evaluate((c) => (window as any).__vaultRepo.outside(c), change);
const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);
const note = async (page: Page, path: string, text: string) => {
  await outside(page, { op: "create", path });
  await outside(page, { op: "modify", path, content: text });
};
const selectedTab = (page: Page) =>
  page.locator('[data-testid="vault-tab"][aria-selected="true"]');

const LONG =
  "Ünïcödé 日本語 notes — a very long name that keeps going and going (draft v2)";

test.describe("hunter L: notes in an Obsidian-shaped vault", () => {
  test.beforeEach(async ({ page }) => {
    await openVault(page, "?seed=obsidian");
    await note(page, "Inbox/index.md", "# Inbox index\n");
    await note(page, "Projects/index.md", "# Projects index\n");
    await note(
      page,
      "Projects/Plan.md",
      "Plan text.\n\n[plan index](index.md)\n\n## Steps\n\n- [/] doing\n- [-] dropped\n",
    );
    await note(
      page,
      "Inbox/Daily.md",
      "# Daily\n\n[own index](index.md)\n\n![[Plan]]\n",
    );
    await note(
      page,
      `Inbox/${LONG}.md`,
      [
        "---",
        'up: "[[Daily]]"',
        "tags: [deep/nested]",
        "---",
        `# ${LONG}`,
        "",
        "> [!tip] Read **this** and [[Daily]]",
        "> first line",
        "> second line",
        "",
        "Body with a footnote[^1] and %%a hidden remark%% #tag/nested.",
        "",
        "- [ ] open",
        "- [>] later",
        "",
        "Averyveryverylongwordwithoutanyspacesthatgoesonforeverandeverandeverandeverandever",
        "",
        "[^1]: The footnote text.",
      ].join("\n"),
    );
    await expect(row(page, "Inbox")).toBeVisible();
    await row(page, "Inbox").click();
  });

  test("an odd-content note reads like Obsidian: callout title, footnote, hidden comment, custom tasks, property link", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await row(page, `Inbox/${LONG}.md`).click();
    const reading = page.getByTestId("note-reading");
    await expect(reading.getByRole("heading", { level: 1 })).toContainText(
      "Ünïcödé",
    );
    // the callout title renders its Markdown
    const title = reading.locator(".callout-title");
    await expect(title.locator("strong")).toHaveText("this");
    await expect(title).not.toContainText("**");
    // the lines under the title keep their break
    await expect(reading.locator(".callout-body")).toContainText("first line");
    // the comment is hidden
    await expect(reading).not.toContainText("hidden remark");
    // no sideways scroll on a long word (G-1)
    const overflow = await reading.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    // the footnote number scrolls to its footnote, the window does not navigate
    const url = page.url();
    await reading.locator(".footnote-ref a").click();
    await expect(reading.locator(".footnotes li").first()).toBeInViewport();
    expect(page.url()).toBe(url);
    // custom status `[>]` is a ticked box with its character
    await expect(reading.locator('li[data-task=">"] input')).toBeChecked();
    // the [[link]] in a property opens the note
    await page.getByTestId("note-properties").getByRole("link").click();
    await expect(selectedTab(page)).toHaveAttribute(
      "data-path",
      "Inbox/Daily.md",
    );
    expect(errors).toEqual([]);
  });

  test("the host note's own Markdown link opens the index next to it", async ({
    page,
  }) => {
    await row(page, "Inbox/Daily.md").click();
    const reading = page.getByTestId("note-reading");
    await reading.getByRole("link", { name: "own index" }).click();
    await expect(selectedTab(page)).toHaveAttribute(
      "data-path",
      "Inbox/index.md",
    );
  });

  // L-4 (toimprove 259): a link inside an embedded note is followed from the HOST's folder.
  test.fail(
    "a Markdown link inside an embedded note opens the file next to that note (L-4)",
    async ({ page }) => {
      await row(page, "Inbox/Daily.md").click();
      const reading = page.getByTestId("note-reading");
      const link = reading.locator(".note-embed").getByRole("link", {
        name: "plan index",
      });
      await link.click();
      await expect(selectedTab(page)).toHaveAttribute(
        "data-path",
        "Projects/index.md",
        { timeout: 3000 },
      );
    },
  );

  // L-8 [improvement]: a task inside an embedded note is a disabled box (NoteView enables only the
  // host's own boxes). Obsidian ticks it, writing the embedded note's file.
  test.fail(
    "a task inside an embedded note can be ticked and is saved in that note (L-8)",
    async ({ page }) => {
      await row(page, "Inbox/Daily.md").click();
      const reading = page.getByTestId("note-reading");
      const box = reading.locator('.note-embed li[data-task="/"] input');
      await expect(box).toBeVisible();
      await expect(box).toBeEnabled({ timeout: 2000 });
      await box.click();
      await expect
        .poll(
          () =>
            page.evaluate(() =>
              (window as any).__noteFiles.textOf("Projects/Plan.md"),
            ),
          { timeout: 3000 },
        )
        .toContain("- [ ] doing");
    },
  );
});
