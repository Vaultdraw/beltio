import { type Page } from "@playwright/test";

import { expect, test } from "../fixture";

import { openVault } from "../helpers";

// Bug hunter J (2026-10-30 evening) [notes], through visible UI on an Obsidian-shaped vault:
// 1. properties (front matter) show in the panel and its tags in the footer, never as text. The
//    browser stand-in that answers here is pinned to the native parser by
//    vaultdraw-core/src/contract/frontmatter_cases.json (COVERAGE-G gap 1).
// 2. ordinary Markdown links open the note Obsidian opens. Rows with `bug` fail until fixed.

const seed = async (page: Page, notes: Record<string, string>) => {
  await page.evaluate((all) => {
    const w = window as any;
    for (const [path, text] of Object.entries(all)) {
      w.__noteFiles.setOnDisk(path, text);
      w.__vaultRepo.seedNote(path);
    }
    w.__vaultRepo.emit({
      handle: w.__vaultRepo.handle,
      paths: [],
      rescan: true,
    });
  }, notes);
};

const openNested = async (page: Page, folder: string, name: string) => {
  await page
    .locator(`[data-tree-path="${folder}"] .vault-tree-item__toggle`)
    .click();
  await page
    .locator(`[data-tree-path="${folder}/${name}.md"] .vault-tree-item__name`)
    .click();
};

test("note properties: front matter shows as properties and tags, not as text", async ({
  page,
}) => {
  await openVault(page, "?seed=obsidian");
  await seed(page, {
    "Props.md":
      "---\ntitle: Weekly plan\nstatus: draft\ntags: [work, plan/q4]\n---\n# Props\n\nBody text.\n",
  });
  await page
    .locator('[data-tree-path="Props.md"] .vault-tree-item__name')
    .click();
  const reading = page.getByTestId("note-reading");
  await expect(reading.getByRole("heading", { name: "Props" })).toBeVisible();
  const props = page.getByTestId("note-properties");
  await expect(props.locator("dt")).toContainText(["title", "status"]);
  await expect(props).toContainText("Weekly plan");
  await expect(props).toContainText("draft");
  const footer = reading.locator("footer.note-tags");
  await expect(footer.locator('[data-tag="work"]')).toHaveText("#work");
  await expect(footer.locator('[data-tag="plan/q4"]')).toHaveText("#plan/q4");
  // The block itself is not drawn as text (no "---" rule, no "title:" line).
  await expect(reading.locator(".note-body")).not.toContainText("title:");
  await expect(reading.locator(".note-body hr")).toHaveCount(0);
  // A footer tag searches the tag.
  await footer.locator('[data-tag="work"]').click();
  await expect(page.getByPlaceholder("Search drawings and text…")).toHaveValue(
    "tag:#work",
  );
});

type LinkRow = { name: string; href: string; opens: string; bug?: string };

const LINKS: LinkRow[] = [
  { name: "a sibling note", href: "Sibling.md", opens: "Sibling" },
  { name: "a ../ path", href: "../Areas/Ideas.md", opens: "Ideas" },
  {
    name: "Obsidian's shortest path (unique name in another folder)",
    href: "Ideas.md",
    opens: "Ideas",
    bug: "toimprove 209",
  },
  {
    name: "Obsidian's absolute path in vault",
    href: "Areas/Ideas.md",
    opens: "Ideas",
    bug: "toimprove 209",
  },
];

for (const row of LINKS) {
  test(`${
    row.bug ? `[${row.bug}, fails until fixed] ` : ""
  }note Markdown link to ${row.name} opens it`, async ({ page }) => {
    if (row.bug) {
      test.fail(true, row.bug);
    }
    await openVault(page, "?seed=obsidian");
    await seed(page, {
      "Projects/Plan.md": `# Plan\n\nSee [the link](${row.href}).\n`,
      "Projects/Sibling.md": "# Sibling\n",
      "Areas/Ideas.md": "# Ideas\n",
    });
    await openNested(page, "Projects", "Plan");
    const reading = page.getByTestId("note-reading");
    await expect(reading.getByRole("heading", { name: "Plan" })).toBeVisible();
    await reading.getByRole("link", { name: "the link" }).click();
    await expect(reading.getByRole("heading", { name: row.opens })).toBeVisible(
      { timeout: 3000 },
    );
  });
}
