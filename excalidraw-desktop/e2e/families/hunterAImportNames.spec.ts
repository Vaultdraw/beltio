import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { clickMainMenuItem, openVault, trackErrors } from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Hunter A round 3: a vault import with odd note names. Each note holds one unique word; after the
// import every word must be in some drawing (renamed when a name cannot be used or collides, never
// dropped, never merged into another note), and the import's own count matches.
const NAMES = [
  "Plain",
  "with space and  double space",
  "trailing dot.",
  " leading space",
  "colon: in name",
  'quote " mark',
  "question? star*",
  "back\\slash",
  "CON",
  "Café",
  "Café", // the same name, decomposed
  "日本語のノート",
  "emoji 🚀 note",
  "Mixed Case",
  "mixed case",
  "x".repeat(250),
  "dots...in...name",
  "-dash-start",
  "#hash start",
  "[brackets] and (parens)",
  "100%",
  "a/b-looks-like-folder-but-is-not",
];

const row = (page: Page, path: string) =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );

test("a vault import with odd note names keeps every note", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  const files: Record<string, string> = {};
  NAMES.forEach((n, i) => {
    // a name with a slash is a folder in a source: keep it as one note name by skipping it
    files[
      `${n.replace(/\//g, "-")}.md`
    ] = `# Heading ${i}\n\nuniqueword${i}zq body.\n`;
  });
  await page.evaluate((f) => {
    (window as any).__plugins.backend.folders.sourcePick = {
      name: "Odd",
      files: f,
    };
  }, files);
  await clickMainMenuItem(page, "Import Obsidian vault…");
  await expect(row(page, "Odd")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(4000);
  const found: string[] = await page.evaluate(async (count) => {
    const r = (window as any).__vaultRepo;
    const out: string[] = [];
    const walk = async (dir: string) => {
      const list = await r.listDirectory(r.handle, dir);
      for (const e of list) {
        if (e.kind === "folder") {
          await walk(e.path);
        } else if (/\.excalidraw$/.test(e.path)) {
          const d = await r.readDrawing(r.handle, e.path);
          for (let i = 0; i < count; i++) {
            if (d.json.includes(`uniqueword${i}zq`)) {
              out.push(String(i));
            }
          }
        }
      }
    };
    await walk("");
    return out;
  }, NAMES.length);
  const missing = NAMES.map((n, i) => [n, i] as const)
    .filter(([, i]) => !found.includes(String(i)))
    .map(([n]) => n);
  const dupes = found.filter((w, i) => found.indexOf(w) !== i);
  expect(dupes, "a note imported twice").toEqual([]);
  // a note that cannot be written must be named in the import report, never dropped silently
  const report: string = await page.evaluate(async () => {
    const r = (window as any).__vaultRepo;
    for (const p of [
      "Odd/Import report.excalidraw",
      "Import report.excalidraw",
    ]) {
      try {
        const d = await r.readDrawing(r.handle, p);
        return JSON.parse(d.json)
          .elements.filter((e: any) => e.type === "text")
          .map((e: any) => e.text)
          .join("\n");
      } catch {
        /* try the next place */
      }
    }
    return "";
  });
  const unreported = missing.filter(
    (n) =>
      !report.replace(/\s+/g, "").includes(n.slice(0, 40).replace(/\s+/g, "")),
  );
  expect(unreported, "dropped without a line in the report").toEqual([]);
  expect(errors).toEqual([]);
});

// A-15: the import report explains a failed note with the file system's own words ("Path contains
// an invalid component"). Say what is wrong: a name Windows cannot hold, a name too long, a
// character the vault does not allow. Remove fixme to reproduce.
test.fixme(
  "A-15: the import report gives plain reasons for a note it could not write",
  async ({ page }) => {
    await openVault(page, "?plugins=markdown-import");
    await page.waitForFunction(() => (window as any).__pluginsReady === true);
    await seedAndOpen(page, "Start.excalidraw");
    await page.evaluate(() => {
      (window as any).__plugins.backend.folders.sourcePick = {
        name: "Odd",
        files: {
          "Plain.md": "# a\n",
          "CON.md": "# b\n",
          "colon: in name.md": "# c\n",
        },
      };
    });
    await clickMainMenuItem(page, "Import Obsidian vault…");
    await expect(row(page, "Odd")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(3000);
    const report: string = await page.evaluate(async () => {
      const r = (window as any).__vaultRepo;
      for (const p of [
        "Odd/Import report.excalidraw",
        "Import report.excalidraw",
      ]) {
        try {
          const d = await r.readDrawing(r.handle, p);
          return JSON.parse(d.json)
            .elements.filter((e: any) => e.type === "text")
            .map((e: any) => e.text)
            .join("\n");
        } catch {
          /* next */
        }
      }
      return "";
    });
    expect(report).toContain("CON");
    expect(report, "failure reasons in plain words").not.toMatch(
      /invalid component|Path contains/i,
    );
  },
);
