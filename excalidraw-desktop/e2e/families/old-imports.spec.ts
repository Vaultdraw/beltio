import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import {
  openVault,
  readScene,
  screenshot,
  SHOTS,
  trackErrors,
} from "../helpers";
import { rect, setupOf } from "../pageHelpers";

// Family: files written by an older version still look and work right (toimprove #102).
// Notes imported before the import followed the vault keep a white "normal" page and the
// hand-drawn font. Opening one offers "Update"; one click gives every imported note the
// user's paper and font (dark theme, Nunito here), keeps code in Cascadia and leaves the
// user's own drawings alone. One row per old file shape.

const NUNITO = 6;
const MARK = { "plugins.markdown-import": { heading: 1 } };

const text = (id: string, y: number, fontFamily: number, extra = {}) => ({
  ...rect(id, 40, y, 300, 30),
  type: "text",
  text: id,
  originalText: id,
  fontSize: 20,
  fontFamily,
  textAlign: "left",
  verticalAlign: "top",
  containerId: null,
  autoResize: true,
  lineHeight: 1.25,
  ...extra,
});

type Row = {
  path: string;
  elements: unknown[];
  appState?: object;
  imported: boolean;
};

const ROWS: Row[] = [
  {
    // Before 5fee99a8: white page, Excalifont, no background colour saved.
    path: "Imported/Old note.excalidraw",
    elements: [
      text("Old heading", 60, 5, { customData: MARK }),
      text("old body", 120, 5),
      text("code()", 180, 3),
      {
        ...rect("web-box", 40, 240, 480, 300),
        type: "rectangle",
        link: "https://example.com/a.png",
      },
      text("Web image: a", 250, 5, { link: "https://example.com/a.png" }),
    ],
    imported: true,
  },
  {
    // Opened and saved once by the old app: explicit white background.
    path: "Imported/Deep/Saved note.excalidraw",
    elements: [
      text("Saved heading", 60, 5, { customData: MARK }),
      text("saved body", 120, 5),
    ],
    appState: { viewBackgroundColor: "#ffffff" },
    imported: true,
  },
  {
    // The user's own drawing in Excalifont on a white page: never touched.
    path: "Mine.excalidraw",
    elements: [text("my words", 60, 5)],
    imported: false,
  },
];

/** Writes files straight into the vault, as an older version left them behind. */
const seedRows = async (page: Page, rows: Row[]) => {
  await page.evaluate(
    (list) => {
      const repo = (window as any).__vaultRepo;
      for (const r of list) {
        repo.seedDrawing(
          r.path,
          JSON.stringify({
            type: "excalidraw",
            version: 2,
            elements: r.elements,
            appState: { pageSetup: r.pageSetup, ...(r.appState ?? {}) },
            files: {},
          }),
        );
      }
      repo.emit({ handle: repo.handle, paths: [], rescan: true });
    },
    rows.map((r) => ({ ...r, pageSetup: setupOf({ paperTheme: "normal" }) })),
  );
  await expect(
    page
      .locator(".vault-tree-item__name", {
        hasText: rows[0].path.split("/")[0].replace(/\.excalidraw$/, ""),
      })
      .first(),
  ).toBeVisible();
};

const treeItem = (page: Page, name: string) =>
  page.locator(".vault-tree-item__name", { hasText: name }).first();

const settings = async (page: Page) => {
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
};

test("notes imported by an older version take the theme and font with one Update", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  await openVault(page);
  const dialog = await settings(page);
  await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
  await dialog
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: "Dark" })
    .click();
  await dialog.getByRole("tab", { name: "Drawing", exact: true }).click();
  await dialog.getByLabel("Default font family").selectOption(String(NUNITO));
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await seedRows(page, ROWS);

  // Open the old note from the file tree, like the owner does.
  await page
    .locator(".vault-tree-item__name", { hasText: "Imported" })
    .first()
    .click();
  await page
    .locator(".vault-tree-item__name", { hasText: "Old note" })
    .first()
    .click();
  const offer = page.getByText("This note was imported with the old look");
  await expect(offer).toBeVisible({ timeout: 15_000 });
  await screenshot(page, {
    path: `${SHOTS}/${info.project.name}-old-import-before.png`,
  });

  // The web picture can be downloaded from the same notice (the import plugin asks consent).
  await expect(
    page.getByRole("button", { name: "Download pictures", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(
    page.getByText("Updated 2 imported notes to your theme and font"),
  ).toBeVisible({
    timeout: 20_000,
  });

  for (const row of ROWS) {
    await test.step(row.path, async () => {
      const scene = await readScene(page, row.path);
      const texts = scene.elements.filter((e: any) => e.type === "text");
      if (row.imported) {
        expect(scene.appState.pageSetup.paperTheme).toBe("match");
        for (const t of texts) {
          expect(t.fontFamily, t.text).toBe(t.text === "code()" ? 3 : NUNITO);
        }
      } else {
        expect(scene.appState.pageSetup.paperTheme).toBe("normal");
        expect(texts[0].fontFamily).toBe(5);
      }
    });
  }
  // The open note reloaded: its page is dark now.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const c = document.querySelector<HTMLCanvasElement>(
            ".vault-editor canvas.static",
          )!;
          const d = c
            .getContext("2d")!
            .getImageData(c.width - 6, c.height - 6, 1, 1).data;
          return 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];
        }),
      { timeout: 10_000 },
    )
    .toBeLessThan(80);
  await screenshot(page, {
    path: `${SHOTS}/${info.project.name}-old-import-after.png`,
  });
  // Nothing more to offer.
  await expect(offer).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Update imported notes here, on a folder's menu, touches only that folder", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  const old = (path: string): Row => ({
    path,
    elements: [text("Heading", 60, 5, { customData: MARK })],
    imported: true,
  });
  await seedRows(page, [
    old("Notes A/One.excalidraw"),
    old("Notes B/Two.excalidraw"),
  ]);
  await treeItem(page, "Notes A").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Update imported notes here" })
    .click();
  await expect(
    page.getByText("Updated 1 imported note to your theme and font"),
  ).toBeVisible({ timeout: 20_000 });
  const a = await readScene(page, "Notes A/One.excalidraw");
  const b = await readScene(page, "Notes B/Two.excalidraw");
  expect(a.appState.pageSetup.paperTheme).not.toBe("normal");
  expect(b.appState.pageSetup.paperTheme).toBe("normal");
  // Files are not folders: the item is only on folder rows.
  await page.keyboard.press("Escape");
  await treeItem(page, "Notes B").click();
  await treeItem(page, "Two").click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Update imported notes here" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("with the offer turned off, opening an old import shows no notice", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page.evaluate(() =>
    (window as any).__updatePreferences({
      pluginSettings: { "markdown-import": { offer_update: false } },
    }),
  );
  await seedRows(page, [ROWS[0]]);
  await treeItem(page, "Imported").click();
  await treeItem(page, "Old note").click();
  await expect(page.locator(".vault-editor")).toHaveAttribute(
    "data-scene-ready",
    "true",
  );
  await page.waitForTimeout(500);
  await expect(
    page.getByText("This note was imported with the old look"),
  ).toHaveCount(0);
  // The command still works from the palette.
  await page.keyboard.press("Meta+Shift+p");
  await page.keyboard.type("Update imported notes");
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Updated 1 imported note to your theme and font"),
  ).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});
