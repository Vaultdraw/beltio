import { type Locator, type Page } from "@playwright/test";

import { expect, test } from "../fixture";

import { openVault } from "../helpers";

// Family (bug hunter G, 2026-10-30): Obsidian's Markdown in the note reading view, seen by the
// user. One row per syntax: the note holds the snippet, the row checks what shows (and what must
// not). Obsidian's reading view is the answer key. Rows with `bug` fail today (test.fail with the
// toimprove number) and turn red when the fix lands. Front matter rows are left out on purpose:
// the browser stand-in parses properties itself (noteDoc.ts), so a Playwright row would test the
// stand-in, not the app.

type Row = {
  name: string;
  md: string;
  check: (reading: Locator, page: Page) => Promise<void>;
  bug?: string;
};

const ROWS: Row[] = [
  {
    name: "a callout shows as a box with its title and body",
    md: "> [!note] Remember this\n> The body line.",
    check: async (r) => {
      const box = r.locator('.callout[data-callout="note"]');
      await expect(box).toBeVisible();
      await expect(box.locator(".callout-title")).toContainText(
        "Remember this",
      );
      await expect(box.locator(".callout-body")).toContainText(
        "The body line.",
      );
      await expect(r).not.toContainText("[!note]");
    },
  },
  {
    name: "a folded callout (-) starts closed and opens on a click",
    md: "> [!tip]- Hidden tip\n> Secret body.",
    check: async (r) => {
      const box = r.locator('details.callout[data-callout="tip"]');
      await expect(box).toBeVisible();
      await expect(box.getByText("Secret body.")).toBeHidden();
      await box.locator("summary").click();
      await expect(box.getByText("Secret body.")).toBeVisible();
    },
  },
  {
    name: "==highlight== is marked",
    md: "Some ==bright words== here.",
    check: async (r) => {
      await expect(r.locator("mark")).toHaveText("bright words");
      await expect(r).not.toContainText("==");
    },
  },
  {
    name: "~~strikethrough~~ is struck",
    md: "Old ~~plan~~ new plan.",
    check: async (r) => {
      await expect(r.locator("del, s")).toHaveText("plan");
    },
  },
  {
    name: "an inline #tag is a chip; a click searches the tag",
    md: "Filed under #project/alpha today.",
    check: async (r, page) => {
      const chip = r.locator('.note-body .note-tag[data-tag="project/alpha"]');
      // The tag is listed in the footer as well, once.
      await expect(
        r.locator('footer.note-tags .note-tag[data-tag="project/alpha"]'),
      ).toHaveCount(1);
      await expect(chip).toHaveText("#project/alpha");
      await chip.click();
      await expect(
        page.getByPlaceholder("Search drawings and text…"),
      ).toHaveValue("tag:#project/alpha");
    },
  },
  {
    name: "a heading-like #1 and a URL fragment are not tags",
    md: "Issue #1 and https://example.com/page#part stay text.",
    check: async (r) => {
      await expect(r.locator(".note-tag")).toHaveCount(0);
    },
  },
  {
    name: "inline and block math render without an error",
    md: "Inline $x^2 + 1$ here.\n\n$$\n\\frac{a}{b}\n$$",
    check: async (r) => {
      await expect(r.locator(".note-math")).toHaveCount(2);
      await expect(r.locator(".note-math-error")).toHaveCount(0);
      // Rendered as a picture, or (formula plugin off) the TeX source as text.
      await expect
        .poll(() =>
          r
            .locator(".note-math")
            .evaluateAll((els) =>
              els.every(
                (e) =>
                  !!e.querySelector("img.note-math-img") ||
                  e.classList.contains("note-math-source"),
              ),
            ),
        )
        .toBe(true);
    },
  },
  {
    name: "a code block with a language is coloured",
    md: '```js\nconst answer = 42; // "x"\n```',
    check: async (r) => {
      const code = r.locator("pre code");
      await expect(code).toContainText("const answer = 42;");
      await expect(code.locator('[class^="tok-"]').first()).toBeVisible();
    },
  },
  {
    name: "a table shows its cells",
    md: "| Name | Count |\n| --- | ---: |\n| Apples | 3 |",
    check: async (r) => {
      await expect(r.locator("table th").first()).toHaveText("Name");
      await expect(r.locator("table td").first()).toHaveText("Apples");
    },
  },
  {
    name: "a [[wikilink|alias]] shows the alias",
    md: "Go to [[Ideas|my ideas]].",
    check: async (r) => {
      const a = r.locator("a.wikilink");
      await expect(a).toHaveText("my ideas");
      await expect(a).not.toHaveClass(/unresolved/);
    },
  },
  {
    name: "a %%comment%% is hidden",
    md: "Seen %%not seen%% text.",
    check: async (r) => {
      await expect(r).toContainText("Seen");
      await expect(r).not.toContainText("not seen");
      await expect(r).not.toContainText("%%");
    },
  },
  {
    name: "a ^block-id at a line end is hidden",
    md: "A paragraph with an id. ^abc123",
    check: async (r) => {
      await expect(r).toContainText("A paragraph with an id.");
      await expect(r).not.toContainText("^abc123");
    },
  },
  {
    name: "a single newline is a line break",
    md: "first line\nsecond line",
    check: async (r) => {
      const p = r.locator("p", { hasText: "first line" });
      await expect(p.locator("br")).toHaveCount(1);
    },
  },
];

for (const row of ROWS) {
  test(`${
    row.bug ? `[${row.bug.split(" (")[0]}, fails until fixed] ` : ""
  }note reading view: ${row.name}`, async ({ page }) => {
    if (row.bug) {
      test.fail(true, row.bug);
    }
    await openVault(page, "?seed=obsidian");
    await page.evaluate((text) => {
      const w = window as any;
      w.__noteFiles.setOnDisk("Syntax.md", `# Syntax\n\n${text}\n`);
      w.__vaultRepo.seedNote("Syntax.md");
      w.__vaultRepo.emit({
        handle: w.__vaultRepo.handle,
        paths: [],
        rescan: true,
      });
    }, row.md);
    await page
      .locator('[data-tree-path="Syntax.md"] .vault-tree-item__name')
      .click();
    const reading = page.getByTestId("note-reading");
    await expect(
      reading.getByRole("heading", { name: "Syntax" }),
    ).toBeVisible();
    await row.check(reading, page);
  });
}
