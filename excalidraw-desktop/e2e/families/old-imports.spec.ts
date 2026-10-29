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

/** The open drawing's live elements with their text and link (React fibers: no window.h in e2e). */
const sceneEls = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
    let fiber = (el as any)[key];
    while (fiber) {
      const s = fiber.stateNode;
      if (s && s.scene && s.state && typeof s.state.scrollX === "number") {
        return s.scene.getNonDeletedElements().map((e: any) => ({
          id: e.id as string,
          type: e.type as string,
          text: e.text as string | undefined,
          link: e.link as string | null,
        }));
      }
      fiber = fiber.return;
    }
    throw new Error("editor instance not found");
  });

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

// toimprove #108: the oldest imports labelled a web picture's box with the bare alt text (no
// "Web image" prefix), the address may have no file extension, and both the box and its label
// carried the link (two overlapping link icons). The kernel note of the owner's vault, in short.
test("an old import's web pictures with bare labels show by themselves when it opens; one link icon stays", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  const PIC = "https://images.example.org/static-rsc-4/ZGgUsQq8?purpose=inline";
  const ARTICLE =
    "https://images.example.org/static-rsc-4/WeeraYi?purpose=inline";
  await page.evaluate(
    ([pic, article]) => {
      const net = (window as any).__plugins.backend.network;
      net.images = {
        [pic]: new TextEncoder().encode(
          `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#f00"/></svg>`,
        ),
        [article]: "NOT_AN_IMAGE",
      };
    },
    [PIC, ARTICLE] as const,
  );
  const box = (id: string, y: number, link: string) => ({
    ...rect(id, 56, y, 480, 300),
    type: "rectangle",
    link,
  });
  await seedRows(page, [
    {
      path: "Kubernetes/kernel.excalidraw",
      elements: [
        text("What is a kernel", 20, 3, { customData: MARK }),
        box("pic-box", 356, PIC),
        text("Close-up of CPU processor chip", 364, 3, { link: PIC, x: 64 }),
        box("article-box", 696, ARTICLE),
        text("How to Install RAM in a PC | Tom's Hardware", 704, 3, {
          link: ARTICLE,
          x: 64,
        }),
      ],
      imported: true,
    },
  ]);
  await treeItem(page, "Kubernetes").click();
  await treeItem(page, "kernel").click();
  // No click and no question: the picture fills in; the one that is not a picture says so, with Retry.
  await expect(page.getByText("Downloaded 1 of 2 pictures")).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await sceneEls(page)).filter((e) => e.type === "image").length,
    )
    .toBe(1);
  const els = await sceneEls(page);
  // The picture took its box's place; the web page stays a box, and only the box is linked now.
  expect(els.some((e) => e.id === "pic-box")).toBe(false);
  const linked = els.filter((e) => e.link === ARTICLE);
  expect(linked.map((e) => e.type)).toEqual(["rectangle"]);
  const label = els.find(
    (e) => e.type === "text" && /Tom's Hardware/.test(e.text ?? ""),
  )!;
  expect(label.text).toMatch(/^Web page, not a picture: How to Install RAM/);
  expect(
    await page.evaluate(
      () => (window as any).__plugins.backend.network.fetched as string[],
    ),
  ).toEqual(expect.arrayContaining([PIC, ARTICLE]));
  expect(errors).toEqual([]);
});

// Re-import (toimprove #108-#110): an old import is rebuilt from its note with what the import draws
// today (real table, kept line breaks). Per note from the drawing's menu, whatever its state; per
// folder only the drawings unchanged since the import. History keeps each one as it was.
const REIMPORT_SOURCE = {
  name: "Obsidian",
  files: {
    "Notes/Table note.md":
      "Line one\nLine two\n\n| Concept | Meaning |\n|---|---|\n| Paging | Pages of memory |",
    "Notes/Edited note.md": "Fresh text",
  },
};

const pickReimportSource = (page: Page) =>
  page.evaluate((src) => {
    (window as any).__plugins.backend.folders.sourcePick = src;
  }, REIMPORT_SOURCE);

test("Re-import from its Markdown rebuilds an old import with a real table and its line breaks", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await pickReimportSource(page);
  const path = "Obsidian/Notes/Table note.excalidraw";
  await seedRows(page, [
    {
      path,
      elements: [
        text("Line one Line two", 60, 5),
        text("Concept │ Meaning │ Paging │ Pages of…", 100, 3),
      ],
      imported: true,
    },
  ]);
  await treeItem(page, "Obsidian").click();
  await treeItem(page, "Notes").click();
  await treeItem(page, "Table note").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Re-import from its Markdown" })
    .click();
  await expect(page.getByText("Re-imported 1 note")).toBeVisible({
    timeout: 30_000,
  });
  const scene = await readScene(page, path);
  const texts = scene.elements
    .filter((e: any) => e.type === "text" && !e.isDeleted)
    .map((e: any) => e.text as string);
  expect(texts.some((t: string) => /Line one\nLine two/.test(t))).toBe(true);
  expect(texts).toContain("Paging");
  expect(texts.join("")).not.toMatch(/[│…]/);
  expect(
    scene.elements.filter((e: any) => e.type === "line").length,
  ).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test("Re-import unchanged imported notes here leaves an edited import alone", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await pickReimportSource(page);
  const edited = [
    { ...text("Old text", 60, 5), created: 1 },
    { ...text("my own words", 120, 5), created: 2 },
  ];
  await seedRows(page, [
    {
      path: "Obsidian/Notes/Table note.excalidraw",
      elements: [{ ...text("Line one Line two", 60, 5), created: 1 }],
      imported: true,
    },
    {
      path: "Obsidian/Notes/Edited note.excalidraw",
      elements: edited,
      imported: true,
    },
  ]);
  // The plugin lists the vault through its own rows (native in the app; the browser stand-in
  // keeps its own list), so the stand-in learns the two paths too.
  await page.evaluate(() => {
    const be = (window as any).__plugins.backend;
    for (const p of [
      "Obsidian/Notes/Table note.excalidraw",
      "Obsidian/Notes/Edited note.excalidraw",
    ]) {
      be.drawings[p] = { scene: { elements: [] }, revision: "r1" };
    }
  });
  await treeItem(page, "Obsidian").click();
  await treeItem(page, "Notes").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Re-import unchanged imported notes here" })
    .click();
  await expect(page.getByText("Re-imported 1 note")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText(/1 note was changed since the import/),
  ).toBeVisible();
  const kept = await readScene(page, "Obsidian/Notes/Edited note.excalidraw");
  expect(kept.elements.map((e: any) => e.text)).toEqual([
    "Old text",
    "my own words",
  ]);
  const rebuilt = await readScene(page, "Obsidian/Notes/Table note.excalidraw");
  expect(
    rebuilt.elements.filter((e: any) => e.type === "line").length,
  ).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});
