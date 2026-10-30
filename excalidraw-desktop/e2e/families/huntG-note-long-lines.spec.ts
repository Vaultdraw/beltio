import { type Page } from "@playwright/test";

import { expect, test } from "../fixture";

import { openVault } from "../helpers";

// Family (bug hunter G, 2026-10-30): long unbroken text in the note reading view. A note with a
// long link, a long word or long inline code must wrap inside the page, like Obsidian's reading
// view (its rendered Markdown breaks long words): the reading view never scrolls sideways. Only a
// code block may scroll, inside its own box. One row per kind of Markdown; add a kind = add a row.
// Run in a narrow (720 px) and a wide (1280 px) window.

const WORD = "Supercalifragilistic".repeat(16); // 320 characters, no break
const URL = `https://example.com/${"very-long-path-segment/".repeat(14)}end`;

type Row = { name: string; md: string };

const ROWS: Row[] = [
  { name: "a long word in a paragraph", md: `Before ${WORD} after.` },
  { name: "a bare long link", md: `See ${URL} for more.` },
  {
    name: "a Markdown link with a long address as its text",
    md: `[${URL}](${URL})`,
  },
  { name: "long inline code", md: `Run \`${WORD}\` now.` },
  { name: "a long word in a heading", md: `## ${WORD}` },
  { name: "a long word in a list item", md: `- ${WORD}` },
  { name: "a long word in a task", md: `- [ ] ${WORD}` },
  { name: "a long word in a quote", md: `> ${WORD}` },
  {
    name: "a long word in a table cell",
    md: `| a | b |\n| - | - |\n| ${WORD} | x |`,
  },
  { name: "a wikilink to a long name", md: `[[${WORD}]]` },
];

const sideways = (page: Page) =>
  page.getByTestId("note-reading").evaluate((el) => ({
    reading: el.scrollWidth - el.clientWidth,
    window: document.documentElement.scrollWidth - innerWidth,
  }));

for (const width of [720, 1280]) {
  for (const r of ROWS) {
    test(`note reading view at ${width} px: ${r.name} wraps, nothing scrolls sideways`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await openVault(page, "?seed=obsidian");
      await page.evaluate((text) => {
        const w = window as any;
        w.__noteFiles.setOnDisk("Long lines.md", `# Long lines\n\n${text}\n`);
        w.__vaultRepo.seedNote("Long lines.md");
        w.__vaultRepo.emit({
          handle: w.__vaultRepo.handle,
          paths: [],
          rescan: true,
        });
      }, r.md);
      await page
        .locator('[data-tree-path="Long lines.md"] .vault-tree-item__name')
        .click();
      await expect(
        page.getByTestId("note-reading").getByRole("heading", {
          name: "Long lines",
        }),
      ).toBeVisible();
      const s = await sideways(page);
      expect(s.reading, "the reading view scrolls sideways").toBeLessThan(2);
      expect(s.window, "the window scrolls sideways").toBeLessThan(2);
    });
  }
}

test("note reading view: a long line in a code block scrolls inside the block only", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 800 });
  await openVault(page, "?seed=obsidian");
  await page.evaluate((word) => {
    const w = window as any;
    w.__noteFiles.setOnDisk("Code.md", `# Code\n\n\`\`\`\n${word}\n\`\`\`\n`);
    w.__vaultRepo.seedNote("Code.md");
    w.__vaultRepo.emit({
      handle: w.__vaultRepo.handle,
      paths: [],
      rescan: true,
    });
  }, WORD);
  await page
    .locator('[data-tree-path="Code.md"] .vault-tree-item__name')
    .click();
  const pre = page.getByTestId("note-reading").locator("pre").first();
  await expect(pre).toBeVisible();
  const s = await sideways(page);
  expect(s.reading, "the reading view scrolls sideways").toBeLessThan(2);
  expect(s.window, "the window scrolls sideways").toBeLessThan(2);
  expect(
    await pre.evaluate((el) => el.scrollWidth > el.clientWidth),
    "the code block scrolls inside itself",
  ).toBe(true);
});
