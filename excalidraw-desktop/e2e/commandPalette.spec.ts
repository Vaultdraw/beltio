import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { AFTER_AUTOSAVE_MS } from "./constants";
import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "./helpers";

const DRAWING = "DSA/Graphs.excalidraw";

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });
const input = (page: Page) => palette(page).getByRole("combobox");
const options = (page: Page) => palette(page).getByRole("option");

const rect = (id: string, x: number, y: number) => ({
  id,
  type: "rectangle",
  x,
  y,
  width: 120,
  height: 80,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  boundElements: [],
  link: null,
  locked: false,
  isDeleted: false,
});

/** Overwrites DSA/Graphs with two rectangles at different x (before opening). */
const seedTwoRects = (page: Page) =>
  page.evaluate(
    ([a, b]) => {
      (window as any).__vaultRepo.seedDrawing(
        "DSA/Graphs.excalidraw",
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          elements: [a, b],
          appState: {},
          files: {},
        }),
      );
    },
    [rect("a", 60, 60), rect("b", 300, 200)],
  );

const openGraphs = async (page: Page, query = "") => {
  await openVault(page, query);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
};

const focusCanvas = async (page: Page) => {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.9);
};

const liveElements = async (page: Page) =>
  (await readScene(page, DRAWING)).elements.filter((el: any) => !el.isDeleted);

/** Commands mode (Cmd+Shift+P, input starts as ">"), then type `query`. */
const runCommand = async (page: Page, query: string, expectFirst: string) => {
  await page.keyboard.press("Meta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await expect(input(page)).toHaveValue(">");
  await page.keyboard.type(query);
  await expect(options(page).first()).toContainText(expectFirst);
};

const rootVar = (page: Page, name: string) =>
  page.evaluate(
    (n) =>
      getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );

test.describe("editor, theme and mode commands", () => {
  test("'>vaultdraw' lists the CLI install commands", async ({ page }) => {
    const errors = trackErrors(page);
    await openVault(page);
    await runCommand(
      page,
      "install 'vaultdraw'",
      "Install 'vaultdraw' command",
    );
    await expect(options(page)).toHaveCount(2);
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
  });

  test("'>align left' aligns the selection and keeps it selected", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openVault(page);
    await page
      .locator(".vault-tree-item__name", { hasText: "DSA" })
      .first()
      .click();
    await seedTwoRects(page);
    await openDrawing(page, "Graphs");
    await focusCanvas(page);
    await page.keyboard.press("Meta+KeyA");

    await runCommand(page, "align left", "Align left");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toHaveCount(0);

    await page.waitForTimeout(AFTER_AUTOSAVE_MS);
    await expect
      .poll(async () => (await liveElements(page)).map((e: any) => e.x))
      .toEqual([60, 60]);
    // Both are still selected: the selection toolbar shows the multi-select
    // alignment actions and Excalidraw reports two selected elements.
    await expect(page.locator(".selected-shape-actions")).toBeVisible();
    // Typing ">" in files mode switches to commands.
    await page.keyboard.press("Meta+KeyP");
    await page.keyboard.type(">align right");
    await expect(options(page).first()).toContainText("Align right");
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
  });

  test("'Theme: Dracula' switches the theme", async ({ page }) => {
    const errors = trackErrors(page);
    await openGraphs(page);
    const before = await rootVar(page, "--vault-bg");
    await runCommand(page, "theme: dracula", "Theme: Dracula");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toHaveCount(0);
    await expect.poll(() => rootVar(page, "--vault-bg")).not.toBe(before);
    // Enter closes and hands focus back to the canvas.
    await expect
      .poll(() =>
        page.evaluate(() =>
          document
            .querySelector(".vault-editor .excalidraw-container")
            ?.contains(document.activeElement),
        ),
      )
      .toBe(true);
    expect(errors).toEqual([]);
  });

  test("'Mode: Dark' makes the app dark", async ({ page }) => {
    await openGraphs(page);
    const isDark = () =>
      page.evaluate(() => document.documentElement.classList.contains("dark"));
    expect(await isDark()).toBe(false);
    await runCommand(page, "mode: dark", "Mode: Dark");
    await page.keyboard.press("Enter");
    await expect.poll(isDark).toBe(true);
    await expect(page.locator(".excalidraw.theme--dark").first()).toBeVisible();
  });

  test("Mod+Enter on 'Toggle grid' keeps the palette open and toggles the grid", async ({
    page,
  }) => {
    await openGraphs(page);
    const grid = async () =>
      (await readScene(page, DRAWING)).appState.gridModeEnabled === true;
    expect(await grid()).toBe(false);
    await runCommand(page, "toggle grid", "Toggle grid");
    await page.keyboard.press("Meta+Enter");
    await expect(palette(page)).toBeVisible();
    await expect(input(page)).toBeFocused();
    await page.waitForTimeout(AFTER_AUTOSAVE_MS);
    await expect.poll(grid).toBe(true);
    await page.keyboard.press("Meta+Enter");
    await expect(palette(page)).toBeVisible();
    await page.waitForTimeout(AFTER_AUTOSAVE_MS);
    await expect.poll(grid).toBe(false);
  });
});

test.describe("opening, shortcuts and focus", () => {
  test("typing a drawing name and Enter opens the drawing", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openVault(page);
    await page.keyboard.press("Meta+KeyP");
    await expect(palette(page)).toBeVisible();
    await page.keyboard.type("introduction");
    await expect(options(page).first()).toContainText("01 Introduction");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toHaveCount(0);
    await expect(
      page.locator(".vault-editor canvas.interactive"),
    ).toBeVisible();
    await expect(page.getByLabel("Breadcrumb")).toContainText(
      "01 Introduction",
    );
    expect(errors).toEqual([]);
  });

  for (const chord of ["Meta+Slash", "Meta+Shift+KeyP"]) {
    test(`${chord} opens our commands mode, never Excalidraw's palette`, async ({
      page,
    }) => {
      const errors = trackErrors(page);
      await openGraphs(page);
      await focusCanvas(page);
      await page.keyboard.press(chord);
      await expect(palette(page)).toBeVisible();
      await expect(input(page)).toBeFocused();
      await expect(input(page)).toHaveValue(">");
      await page.waitForTimeout(400);
      await expect(page.locator(".command-palette-dialog")).toHaveCount(0);
      await expect(page.locator(".Toast")).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(palette(page)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test("Escape closes and focus returns to the canvas", async ({ page }) => {
    await openGraphs(page);
    await focusCanvas(page);
    await page.keyboard.press("Meta+KeyP");
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette(page)).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document
            .querySelector(".vault-editor .excalidraw-container")
            ?.contains(document.activeElement),
        ),
      )
      .toBe(true);
  });

  test("Tab drills a theme into '>Theme: '", async ({ page }) => {
    await openVault(page);
    await page.keyboard.press("Meta+Shift+KeyP");
    await page.keyboard.type("theme");
    // The "Family: Theme" row leads; Tab browses it (so does a Theme: row).
    await expect(options(page).first()).toContainText("Family: Theme");
    await page.keyboard.press("Tab");
    await expect(input(page)).toHaveValue(">Theme: ");
    await expect(input(page)).toBeFocused();
    // The ten bundled themes lead. The drill query is fuzzy, so non-theme
    // matches (for example "Sync canvas with theme") can follow them.
    const bundled = 10;
    for (let i = 0; i < bundled; i++) {
      await expect(options(page).nth(i)).toContainText("Theme: ");
    }
  });
});

test("'Insert: <library item>' inserts it on the canvas", async ({ page }) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page.evaluate(
    (item) => {
      (window as any).__libraryRepo.setFile(
        "personal",
        JSON.stringify({
          type: "excalidrawlib",
          version: 2,
          source: "https://excalidraw.com",
          libraryItems: [item],
        }),
      );
    },
    {
      id: "kanban",
      status: "unpublished",
      created: 1,
      name: "Kanban card",
      elements: [
        {
          ...rect("kanban-r", 0, 0),
          seed: 7,
          version: 1,
          versionNonce: 7,
          updated: 1,
        },
      ],
    },
  );
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await seedTwoRects(page);
  await openDrawing(page, "Graphs");
  await focusCanvas(page);

  // The library loads lazily (idle), so retry until the entry is listed.
  await expect(async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+Shift+KeyP");
    await expect(palette(page)).toBeVisible();
    await page.keyboard.type("kanban");
    await expect(options(page).first()).toContainText("Insert: Kanban card", {
      timeout: 500,
    });
  }).toPass({ timeout: 10_000 });
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);

  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  await expect.poll(async () => (await liveElements(page)).length).toBe(3);
  const inserted = (await liveElements(page)).filter(
    (e: any) => e.id !== "a" && e.id !== "b",
  );
  expect(inserted).toHaveLength(1);
  expect(inserted[0].type).toBe("rectangle");
  expect(errors).toEqual([]);
});

test.describe("two modes: Cmd+P files, Cmd+Shift+P commands", () => {
  const PREFS_KEY = "excalidraw-vault-preferences-v1";
  const seedHotkeys = (page: Page, hotkeys: Record<string, string[]>) =>
    page.addInitScript(
      ([key, value]) => {
        if (!window.sessionStorage.getItem("palette-seeded")) {
          window.localStorage.setItem(key, JSON.stringify(value));
          window.sessionStorage.setItem("palette-seeded", "1");
        }
      },
      [PREFS_KEY, { hotkeys }] as const,
    );
  const texts = (page: Page) => options(page).allTextContents();

  test("Cmd+P lists drawings only, '>' switches to commands and back", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openGraphs(page);
    await page.keyboard.press("Meta+KeyP");
    await expect(input(page)).toHaveValue("");
    await expect(input(page)).toHaveAccessibleName("Go to drawing");
    await expect(options(page).first()).toBeVisible();
    expect((await texts(page)).some((t) => t.includes("Save drawing"))).toBe(
      false,
    );
    await page.keyboard.type("save");
    await expect(
      palette(page).getByText("Save drawing", { exact: true }),
    ).toHaveCount(0);
    // A leading ">" switches to commands for the same text...
    await input(page).evaluate((el: HTMLInputElement) =>
      el.setSelectionRange(0, 0),
    );
    await page.keyboard.type(">");
    await expect(input(page)).toHaveValue(">save");
    await expect(input(page)).toHaveAccessibleName("Run a command");
    await expect(
      palette(page).getByText("Save drawing", { exact: true }),
    ).toBeVisible();
    // ...and deleting it switches back to drawings.
    await page.keyboard.press("Backspace");
    await expect(input(page)).toHaveValue("save");
    await expect(input(page)).toHaveAccessibleName("Go to drawing");
    await expect(
      palette(page).getByText("Save drawing", { exact: true }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("Cmd+Shift+P lists commands only", async ({ page }) => {
    await openVault(page);
    await page.keyboard.press("Meta+Shift+KeyP");
    await expect(input(page)).toHaveValue(">");
    await expect(palette(page).getByText("Search commands")).toBeVisible();
    await expect(palette(page).getByText("Open settings")).toBeVisible();
    await expect(palette(page).getByText("01 Introduction")).toHaveCount(0);
    await page.keyboard.type("intro");
    await expect(palette(page).getByText("01 Introduction")).toHaveCount(0);
  });

  test("the same shortcut closes, the other one switches", async ({ page }) => {
    await openGraphs(page);
    await focusCanvas(page);
    await page.keyboard.press("Meta+KeyP");
    await page.keyboard.type("graphs");
    await page.keyboard.press("Meta+Shift+KeyP");
    await expect(input(page)).toHaveValue(">");
    await page.keyboard.press("Meta+KeyP");
    await expect(input(page)).toHaveValue("");
    await expect(input(page)).toBeFocused();
    await page.keyboard.press("Meta+KeyP");
    await expect(palette(page)).toHaveCount(0);

    await page.keyboard.press("Meta+Shift+KeyP");
    await expect(input(page)).toHaveValue(">");
    await page.keyboard.press("Meta+Shift+KeyP");
    await expect(palette(page)).toHaveCount(0);

    await page.keyboard.press("Meta+Slash");
    await expect(input(page)).toHaveValue(">");
    await page.keyboard.press("Meta+Slash");
    await expect(palette(page)).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document
            .querySelector(".vault-editor .excalidraw-container")
            ?.contains(document.activeElement),
        ),
      )
      .toBe(true);
  });

  test("rebinding palette.files moves files mode to the new key", async ({
    page,
  }) => {
    await seedHotkeys(page, { "palette.files": ["Mod+K"] });
    await openGraphs(page);
    await focusCanvas(page);
    await page.keyboard.press("Meta+KeyK");
    await expect(input(page)).toHaveValue("");
    await expect(input(page)).toHaveAccessibleName("Go to drawing");
    await page.keyboard.press("Meta+Shift+KeyP");
    await expect(input(page)).toHaveValue(">");
    await page.keyboard.press("Meta+KeyK");
    await expect(input(page)).toHaveValue("");
    await page.keyboard.press("Meta+KeyK");
    await expect(palette(page)).toHaveCount(0);
    await page.keyboard.press("Meta+KeyP");
    await page.waitForTimeout(300);
    await expect(palette(page)).toHaveCount(0);
  });

  test("an F41 palette.quickSwitcher entry still applies (to files mode)", async ({
    page,
  }) => {
    await seedHotkeys(page, { "palette.quickSwitcher": ["Mod+K"] });
    await openGraphs(page);
    await focusCanvas(page);
    await page.keyboard.press("Meta+KeyK");
    await expect(palette(page)).toBeVisible();
    await expect(input(page)).toHaveAccessibleName("Go to drawing");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+Shift+KeyP");
    await expect(input(page)).toHaveValue(">");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+KeyP");
    await page.waitForTimeout(300);
    await expect(palette(page)).toHaveCount(0);
  });
});

test.describe("navigator collapsed", () => {
  const collapse = async (page: Page) => {
    await page.keyboard.press("Meta+Backslash");
    await expect(page.getByLabel("Vault file navigator")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  };

  test("'Rename drawing' works", async ({ page }) => {
    const errors = trackErrors(page);
    await openGraphs(page);
    await collapse(page);
    await runCommand(page, "rename drawing", "Rename drawing");
    await page.keyboard.press("Enter");
    // The modal is rendered inside the aria-hidden navigator, so role/label
    // queries cannot see it (an a11y bug); find it by CSS.
    const dialog = page.locator(".vault-modal", { hasText: "Rename Drawing" });
    await expect(dialog).toBeVisible();
    await dialog.locator("input").fill("Graphs Renamed");
    await dialog.locator("button[type=submit]").click();
    await expect
      .poll(
        async () =>
          (
            await readScene(page, "DSA/Graphs Renamed.excalidraw")
          ).elements.length,
      )
      .toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("Escape closes dialogs opened from the palette (#19)", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openGraphs(page);
    await collapse(page);
    for (const [query, label, title] of [
      ["new folder", "New folder", "New folder"],
      ["rename drawing", "Rename drawing", "Rename Drawing"],
    ] as const) {
      await runCommand(page, query, label);
      await page.keyboard.press("Enter");
      const dialog = page.locator(".vault-modal", { hasText: title });
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });

  test("'New folder' works", async ({ page }) => {
    const errors = trackErrors(page);
    await openGraphs(page);
    await collapse(page);
    await runCommand(page, "new folder", "New folder");
    await page.keyboard.press("Enter");
    const dialog = page.locator(".vault-modal", { hasText: "New folder" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("input")).toBeFocused();
    await dialog.locator("input").fill("Palette Folder");
    await dialog.locator("button[type=submit]").click();
    await expect(dialog).toHaveCount(0);
    // Expand the navigator: the folder exists.
    await page.keyboard.press("Meta+Backslash");
    await expect(
      page.locator(".vault-tree-item__name", { hasText: "Palette Folder" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test("perf: palette on 5,000 drawings with an open editor", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openGraphs(page, "?seed=names5k");
  await focusCanvas(page);
  await page.keyboard.press("Meta+KeyA");

  const open = await page.evaluate(async () => {
    const t0 = performance.now();
    const marks: { rows?: number; listed?: number } = {};
    const done = new Promise<void>((resolve) => {
      const check = () => {
        const rows = document.querySelectorAll(".vault-quick__row");
        if (rows.length && marks.rows === undefined) {
          marks.rows = performance.now() - t0;
        }
        if (
          marks.listed === undefined &&
          [...rows].some((r) => r.textContent?.includes("Area "))
        ) {
          marks.listed = performance.now() - t0;
          observer.disconnect();
          resolve();
        }
      };
      const observer = new MutationObserver(check);
      observer.observe(document.body, { childList: true, subtree: true });
    });
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "p",
        code: "KeyP",
        metaKey: /Mac/i.test(navigator.platform),
        ctrlKey: !/Mac/i.test(navigator.platform),
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.race([done, new Promise((r) => setTimeout(r, 15_000))]);
    return marks;
  });
  await expect(palette(page)).toBeVisible();
  expect(open.listed, "names list rendered").toBeDefined();

  // Editor items are in the list (opened from the canvas with a drawing open).
  await page.keyboard.type(">align");
  await expect(palette(page).getByText("Align left").first()).toBeVisible();
  await page.keyboard.press("Meta+KeyA");
  await page.keyboard.press("Backspace");

  const samples = await page.evaluate(async () => {
    const el = document.querySelector<HTMLInputElement>(".vault-quick__input")!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    const frame = () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );
    const queries = ["dsgndrft53", ">thmdrk", ">alignl"];
    const commit: number[] = [];
    const paint: number[] = [];
    for (const query of queries) {
      for (let round = 0; round < 3; round++) {
        setter.call(el, "");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        await frame();
        for (let i = 1; i <= query.length; i++) {
          setter.call(el, query.slice(0, i));
          const t0 = performance.now();
          el.dispatchEvent(new Event("input", { bubbles: true }));
          const t1 = performance.now();
          await frame();
          const t2 = performance.now();
          commit.push(t1 - t0);
          paint.push(t2 - t0);
        }
      }
    }
    return { commit, paint };
  });

  // Commands mode open (collects ~150 editor items), from the canvas.
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  const openCommands = await page.evaluate(async () => {
    const t0 = performance.now();
    let listed: number | undefined;
    const done = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        const rows = document.querySelectorAll(".vault-quick__row");
        if (rows.length) {
          listed = performance.now() - t0;
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    const mac = /Mac/i.test(navigator.platform);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "P",
        code: "KeyP",
        shiftKey: true,
        metaKey: mac,
        ctrlKey: !mac,
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.race([done, new Promise((r) => setTimeout(r, 15_000))]);
    return listed;
  });
  await expect(input(page)).toHaveValue(">");
  expect(openCommands, "commands listed").toBeDefined();

  const stat = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (p: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    return {
      p50: +at(0.5).toFixed(2),
      p95: +at(0.95).toFixed(2),
      max: +sorted[sorted.length - 1].toFixed(2),
    };
  };
  const report = {
    drawings: 5000,
    openMs: {
      firstRows: +(open.rows ?? 0).toFixed(1),
      names5kRendered: +(open.listed ?? 0).toFixed(1),
      commandsRendered: +(openCommands ?? 0).toFixed(1),
    },
    keystrokes: samples.commit.length,
    commitMs: stat(samples.commit),
    toNextFrameMs: stat(samples.paint),
  };
  // eslint-disable-next-line no-console
  console.log(`COMMAND_PALETTE_PERF ${JSON.stringify(report)}`);
  expect(report.commitMs.p95).toBeLessThan(16);
});
