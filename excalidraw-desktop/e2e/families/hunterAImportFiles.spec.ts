import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { openVault, trackErrors } from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Hunter A round 3: "Import file…" (right-click the canvas) with files a user really has:
// odd extensions and cases, an empty file, a file with only front matter, a BOM and Windows line
// ends, a very long single line, a 3 MB note, a name with spaces, accents and emoji, and a binary
// file called .md. Each one either becomes a drawing named after the file or says in plain words
// why not: never a silent nothing, a raw error, or a stuck progress notice.
type Row = {
  name: string;
  body: Buffer | string;
  mime?: string;
  expect: "drawing" | "either";
};
const ROWS: Row[] = [
  { name: "Plain.md", body: "# Plain\n\nBody words.\n", expect: "drawing" },
  { name: "UPPER.MD", body: "# Upper\n\nUpper words.\n", expect: "drawing" },
  {
    name: "Long name with spaces ünï 🚀.md",
    body: "# Odd name\n\nOdd words.\n",
    expect: "drawing",
  },
  {
    name: "Windows.md",
    body: "﻿# Win\r\n\r\nCRLF words.\r\n",
    expect: "drawing",
  },
  {
    name: "Only front matter.md",
    body: "---\ntitle: x\ntags: [a]\n---\n",
    expect: "either",
  },
  {
    name: "One huge line.md",
    body: "word ".repeat(200_000),
    expect: "drawing",
  },
  {
    name: "Notes.markdown",
    body: "# Markdown ext\n\nExt words.\n",
    expect: "either",
  },
  {
    name: "Binary.md",
    body: Buffer.from([0, 1, 2, 3, 255, 254, 0, 0, 7, 8, 9]),
    expect: "either",
  },
];

const importFile = async (page: Page, row: Row) => {
  // back to the empty Start drawing: an imported drawing has content under the pointer
  await page
    .locator(".vault-tree-item__name", { hasText: /^Start$/ })
    .first()
    .click();
  await page.waitForTimeout(400);
  const canvas = page.locator(".vault-editor canvas.interactive");
  const b = (await canvas.boundingBox())!;
  await canvas.click({
    button: "right",
    position: { x: b.width - 60, y: b.height - 60 },
  });
  const chooser = page.waitForEvent("filechooser");
  await page
    .locator(".context-menu")
    .getByRole("button", { name: "Import file…" })
    .click();
  await (
    await chooser
  ).setFiles({
    name: row.name,
    mimeType: row.mime ?? "text/markdown",
    buffer: Buffer.isBuffer(row.body) ? row.body : Buffer.from(row.body),
  });
};

test("Import file… copes with the files a user really has", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  const problems: string[] = [];
  for (const row of ROWS) {
    const base = row.name.replace(/\.[^.]+$/, "");
    const before = await page.locator(".vault-tree-item__name").count();
    await importFile(page, row);
    // wait for a new drawing, or for a notice
    const settled = await expect
      .poll(
        async () => {
          const names = await page
            .locator(".vault-tree-item__name")
            .allInnerTexts();
          const toast = (await page.locator(".vd-toast").allInnerTexts()).join(
            " ",
          );
          return (
            names.some((n) => n.includes(base.slice(0, 12))) ||
            names.length > before ||
            toast.length > 0
          );
        },
        { timeout: 20_000 },
      )
      .toBe(true)
      .then(() => true)
      .catch(() => false);
    const names = await page.locator(".vault-tree-item__name").allInnerTexts();
    const made = names.some((n) => n.includes(base.slice(0, 12)));
    const toast = (await page.locator(".vd-toast").allInnerTexts()).join(" | ");
    if (!settled) {
      problems.push(`${row.name}: nothing happened (no drawing, no notice)`);
    } else if (row.expect === "drawing" && !made) {
      problems.push(
        `${row.name}: no drawing named after it (notice: ${toast || "none"})`,
      );
    }
    if (
      /undefined|\[object|TypeError|ReferenceError|at .*\.(ts|js):\d+/.test(
        toast,
      )
    ) {
      problems.push(`${row.name}: raw error in the notice: ${toast}`);
    }
    // let notices go, and make sure no progress notice is stuck
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(6000);
  const stuck = (await page.locator(".vd-toast").allInnerTexts()).join(" | ");
  if (/Importing|Reading|…$/.test(stuck)) {
    problems.push(`a progress notice is still showing: ${stuck}`);
  }
  expect(problems, problems.join("\n")).toEqual([]);
  expect(errors).toEqual([]);
});

// A-14: an empty or blank note imported with "Import file…" does nothing at all: no drawing, no
// notice (the log says parts: 0). The vault import writes an empty drawing for the same note, and
// Obsidian opens an empty note as an empty note: it now makes an empty drawing.
for (const [name, body] of [
  ["Empty.md", ""],
  ["Blank lines.md", "   \n\n  \n"],
] as const) {
  test(`A-14: importing ${name} makes a drawing or says why not`, async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openVault(page, "?plugins=markdown-import");
    await page.waitForFunction(() => (window as any).__pluginsReady === true);
    await seedAndOpen(page, "Start.excalidraw");
    const before = await page.locator(".vault-tree-item__name").count();
    await importFile(page, { name, body, expect: "either" });
    const reaction = async () => {
      const names = await page
        .locator(".vault-tree-item__name")
        .allInnerTexts();
      const toast = (await page.locator(".vd-toast").allInnerTexts())
        .join(" ")
        .replace(/Saved/g, "")
        .trim();
      return names.length > before || toast.length > 0;
    };
    await expect.poll(reaction, { timeout: 10_000 }).toBe(true);
    expect(errors).toEqual([]);
  });
}
