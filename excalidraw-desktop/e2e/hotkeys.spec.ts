import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import {
  canvasBox,
  openDrawing,
  openVault,
  reloadVault,
  readScene,
  trackErrors,
} from "./helpers";

const PREFS_KEY = "excalidraw-vault-preferences-v1";
const DRAWING = "DSA/Graphs.excalidraw";
const textarea = "textarea.excalidraw-wysiwyg";

const seedPreferences = (page: Page, prefs: Record<string, unknown>) =>
  page.addInitScript(
    ([key, value]) => {
      if (!window.sessionStorage.getItem("hk-seeded")) {
        window.localStorage.setItem(key as string, JSON.stringify(value));
        window.sessionStorage.setItem("hk-seeded", "1");
      }
    },
    [PREFS_KEY, prefs] as const,
  );

const prefs = (page: Page) =>
  page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  }, PREFS_KEY);

const drawingCount = (page: Page) =>
  page.evaluate(() => (window as any).__vaultRepo.files.size as number);

const liveTextElements = async (page: Page) =>
  (await readScene(page, DRAWING)).elements
    .filter((el: any) => el.type === "text" && !el.isDeleted)
    .map((el: any) => el.text as string);

const liveElementCount = async (page: Page) =>
  (await readScene(page, DRAWING)).elements.filter((el: any) => !el.isDeleted)
    .length;

const openGraphs = async (page: Page, query = "") => {
  await openVault(page, query);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
};

const rectangleTool = (page: Page) =>
  page.locator(".vault-editor [data-testid='toolbar-rectangle']");

const settingsModal = (page: Page) => page.locator(".vault-settings-modal");
const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });
const expectNoOverlay = async (page: Page) => {
  await expect(page.locator(".vault-modal-backdrop")).toHaveCount(0);
  await expect(page.locator(".Modal")).toHaveCount(0);
};

/** Draws a rectangle with the keyboard-selected tool (it ends up selected). */
const drawRectangle = async (page: Page) => {
  const box = await canvasBox(page);
  await page.keyboard.press("r");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35, {
    steps: 6,
  });
  await page.mouse.up();
};

const openHotkeysPage = async (page: Page) => {
  await page.keyboard.press("Meta+Comma");
  await expect(settingsModal(page)).toBeVisible();
  await page.getByRole("tab", { name: "Hotkeys" }).click();
  await expect(page.getByLabel("Filter hotkeys")).toBeVisible();
};

const row = (page: Page, id: string) =>
  page.locator(`.vault-hotkeys__row[data-command-id="${id}"]`);

const closeSettings = async (page: Page) => {
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(settingsModal(page)).toHaveCount(0);
};

// ---------------------------------------------------------------------------
// Typing never triggers commands
// ---------------------------------------------------------------------------

test.describe("typing never triggers commands", () => {
  // Bind every modifier-free key the typed string contains, so a regression
  // in the text-editing guard would fire a visible command.
  const HOSTILE = {
    hotkeys: {
      "vault.newDrawing": ["N"],
      "settings.open": ["Comma"],
      "palette.quickSwitcher": ["P"],
      "view.toggleNavigator": ["Backslash"],
      "view.zoomReset": ["0"],
      "view.zoomIn": ["Equal", "Shift+D"],
      "view.zoomOut": ["Minus"],
      "navigator.focusSearch": ["F"],
      "file.duplicate": ["Space"],
      "file.save": ["Shift+P", "Shift+N", "Shift+F", "Shift+S"],
    },
    zoom: 120,
  };
  const TYPED = "Pn,\\ 0=-f PNFSD";

  test.beforeEach(async ({ page }) => {
    await seedPreferences(page, HOSTILE);
  });

  const expectUntouched = async (page: Page, drawings: number) => {
    await expectNoOverlay(page);
    expect(await drawingCount(page)).toBe(drawings);
    expect((await prefs(page)).zoom).toBe(120);
    await expect(
      page.getByRole("button", { name: "Hide navigator" }),
    ).toBeVisible();
  };

  test("the bound keys do work outside text fields (guard against a vacuous test)", async ({
    page,
  }) => {
    await openGraphs(page);
    const box = await canvasBox(page);
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8);
    await page.keyboard.press("Comma");
    await expect(settingsModal(page)).toBeVisible();
  });

  test("the Excalidraw text editor receives every character", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openGraphs(page);
    const drawings = await drawingCount(page);
    const box = await canvasBox(page);
    await page.mouse.dblclick(
      box.x + box.width * 0.6,
      box.y + box.height * 0.7,
    );
    await expect(page.locator(textarea)).toBeFocused();
    const toolBefore = await page
      .locator(".vault-editor [data-testid='toolbar-text']")
      .getAttribute("aria-pressed");

    await page.keyboard.type(TYPED);
    await page.keyboard.press("Shift+KeyD");
    await expect(page.locator(textarea)).toHaveValue(`${TYPED}D`);
    await expectUntouched(page, drawings);
    await expect(rectangleTool(page)).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.locator(".vault-editor [data-testid='toolbar-text']"),
    ).toHaveAttribute("aria-pressed", toolBefore ?? "false");

    await page.keyboard.press("Escape");
    await expect(page.locator(textarea)).toHaveCount(0);
    await expect
      .poll(() => liveTextElements(page), { timeout: 5000 })
      .toContain(`${TYPED}D`);
    expect(await drawingCount(page)).toBe(drawings);
    expect(errors).toEqual([]);
  });

  test("the navigator search input and the Settings filter boxes take the same text", async ({
    page,
  }) => {
    await openGraphs(page);
    const drawings = await drawingCount(page);

    const search = page.getByPlaceholder("Search drawings and text…");
    await search.click();
    await page.keyboard.type(TYPED);
    await expect(search).toHaveValue(TYPED);
    await expectUntouched(page, drawings);
    await search.fill("");

    await page
      .getByLabel("Vault file navigator")
      .getByRole("button", { name: "Settings" })
      .click();
    await expect(settingsModal(page)).toBeVisible();
    const settingsSearch = page.getByLabel("Search settings");
    await settingsSearch.click();
    await page.keyboard.type(TYPED);
    await expect(settingsSearch).toHaveValue(TYPED);
    await expect(page.locator(".vault-quick")).toHaveCount(0);
    expect(await drawingCount(page)).toBe(drawings);
    expect((await prefs(page)).zoom).toBe(120);
    await settingsSearch.fill("");

    await page.getByRole("tab", { name: "Hotkeys" }).click();
    const filter = page.getByLabel("Filter hotkeys");
    await filter.click();
    await page.keyboard.type(TYPED);
    await expect(filter).toHaveValue(TYPED);
    await expect(settingsModal(page)).toBeVisible();
    await expect(page.locator(".vault-quick")).toHaveCount(0);
    expect(await drawingCount(page)).toBe(drawings);
  });
});

// ---------------------------------------------------------------------------
// Unbound keys still reach Excalidraw; default chords work
// ---------------------------------------------------------------------------

test.describe("default chords", () => {
  test.beforeEach(async ({ page }) => {
    await openGraphs(page);
  });

  test("unbound keys still reach Excalidraw (tool letter, undo)", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const box = await canvasBox(page);
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.9);
    await expect(rectangleTool(page)).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("r");
    await expect(rectangleTool(page)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");

    const before = await liveElementCount(page);
    await drawRectangle(page);
    await expect.poll(() => liveElementCount(page)).toBe(before + 1);
    await page.keyboard.press("Meta+z");
    await expect.poll(() => liveElementCount(page)).toBe(before);

    // Cmd+Shift+P (Excalidraw's own palette chord) opens Vaultdraw's palette;
    // Excalidraw's palette is never mounted.
    await page.keyboard.press("Meta+Shift+KeyP");
    await expect(palette(page)).toBeVisible();
    await expect(page.locator(".command-palette-dialog")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(palette(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("Cmd/Ctrl+, opens Settings and Cmd/Ctrl+Shift+F focuses the navigator search", async ({
    page,
  }) => {
    await page.keyboard.press("Meta+Comma");
    await expect(settingsModal(page)).toBeVisible();
    await closeSettings(page);

    await page.keyboard.press("Meta+Shift+KeyF");
    await expect(
      page.getByPlaceholder("Search drawings and text…"),
    ).toBeFocused();
  });

  test("Cmd/Ctrl+N creates a new drawing, Cmd/Ctrl+Backslash toggles the navigator", async ({
    page,
  }) => {
    const before = await drawingCount(page);
    await page.keyboard.press("Meta+KeyN");
    await expect.poll(() => drawingCount(page)).toBe(before + 1);

    const nav = page.getByLabel("Vault file navigator", { exact: true });
    const width = async () => (await nav.boundingBox())?.width ?? 0;
    expect(await width()).toBeGreaterThan(100);
    await page.keyboard.press("Meta+Backslash");
    await expect.poll(width).toBeLessThan(2);
    await page.keyboard.press("Meta+Backslash");
    await expect.poll(width).toBeGreaterThan(100);
  });

  test("Cmd/Ctrl+Alt+N opens the template picker", async ({ page }) => {
    await page.keyboard.press("Meta+Alt+KeyN");
    await expect(page.locator(".template-picker")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".template-picker")).toHaveCount(0);
  });

  test("Cmd/Ctrl+Shift+= / - / 0 change the interface zoom", async ({
    page,
  }) => {
    await page.keyboard.press("Meta+Comma");
    await expect(settingsModal(page)).toBeVisible();
    await page.getByRole("tab", { name: "Interface" }).click();
    const readout = (value: number) =>
      page.getByText(`${value} %`, { exact: true });
    await expect(readout(100)).toBeVisible();

    await page.keyboard.press("Meta+Shift+Equal");
    await expect(readout(110)).toBeVisible();
    await page.keyboard.press("Meta+Shift+Minus");
    await page.keyboard.press("Meta+Shift+Minus");
    await expect(readout(90)).toBeVisible();
    expect((await prefs(page)).zoom).toBe(90);
    await page.keyboard.press("Meta+Shift+Digit0");
    await expect(readout(100)).toBeVisible();
  });
});

// Not in "default chords": it needs its own autosave query on first load.
test("Cmd/Ctrl+S outside the text editor saves immediately", async ({
  page,
}) => {
  const errors = trackErrors(page);
  // A long idle autosave proves the save came from the shortcut.
  await openGraphs(page, "?autosave=60000");
  const before = await liveElementCount(page);
  await drawRectangle(page);
  await page.keyboard.press("Meta+s");
  await expect
    .poll(() => liveElementCount(page), { timeout: 5000 })
    .toBe(before + 1);
  expect(errors).toEqual([]);
});

/** Counts vault writes of DRAWING and browser downloads from now on. */
const trackSaves = async (page: Page) => {
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await page.evaluate((path) => {
    const repo = (window as any).__vaultRepo;
    const w = window as any;
    w.__saves = 0;
    if (!w.__savesWrapped) {
      w.__savesWrapped = true;
      const write = repo.writeDrawing.bind(repo);
      repo.writeDrawing = (input: { path: string }, ...rest: unknown[]) => {
        if (input?.path === path) {
          w.__saves++;
        }
        return write(input, ...rest);
      };
    }
  }, DRAWING);
  return {
    downloads,
    saves: () => page.evaluate(() => (window as any).__saves as number),
    reset: () => page.evaluate(() => ((window as any).__saves = 0)),
  };
};

test("Cmd/Ctrl+Shift+S saves to the vault once, without Excalidraw's download", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openGraphs(page, "?autosave=60000");
  const tracked = await trackSaves(page);
  const before = await liveElementCount(page);
  await drawRectangle(page);
  await tracked.reset();
  await page.keyboard.press("Meta+Shift+KeyS");
  await expect
    .poll(() => liveElementCount(page), { timeout: 5000 })
    .toBe(before + 1);
  await page.waitForTimeout(800);
  expect(await tracked.saves()).toBe(1);
  expect(tracked.downloads).toEqual([]);
  await expect(page.locator(".Toast")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("macOS keeps the Ctrl aliases: Ctrl+S saves, Ctrl+, and Ctrl+Shift+F work", async ({
  page,
}) => {
  const isMac = await page.evaluate(() =>
    /Mac/i.test(window.navigator.platform),
  );
  test.skip(!isMac, "Ctrl is already Mod off macOS");
  await openGraphs(page, "?autosave=60000");
  const tracked = await trackSaves(page);
  const before = await liveElementCount(page);
  await drawRectangle(page);
  await tracked.reset();
  await page.keyboard.press("Control+KeyS");
  await expect
    .poll(() => liveElementCount(page), { timeout: 5000 })
    .toBe(before + 1);
  expect(await tracked.saves()).toBe(1);

  await page.keyboard.press("Control+Comma");
  await expect(settingsModal(page)).toBeVisible();
  await closeSettings(page);
  await page.keyboard.press("Control+Shift+KeyF");
  await expect(
    page.getByPlaceholder("Search drawings and text…"),
  ).toBeFocused();
});

// ---------------------------------------------------------------------------
// The Hotkeys page
// ---------------------------------------------------------------------------

test.describe("Hotkeys settings page", () => {
  test.beforeEach(async ({ page }) => {
    await openGraphs(page);
    await openHotkeysPage(page);
  });

  const chips = (page: Page, id: string) =>
    row(page, id).locator(".vault-hotkeys__chip-key");
  const add = (page: Page, title: string) =>
    page.getByRole("button", {
      name: `Add hotkey for ${title}`,
      exact: true,
    });

  test("rebinds New drawing live: the new chord works, the default still does, x removes it, reset restores it", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await expect(chips(page, "vault.newDrawing")).toHaveCount(1);
    await add(page, "New drawing").click();
    await expect(page.getByText("Press keys…")).toBeVisible();
    await page.keyboard.press("Meta+Alt+KeyJ");
    await expect(chips(page, "vault.newDrawing")).toHaveCount(2);
    expect((await prefs(page)).hotkeys["vault.newDrawing"]).toEqual([
      "Mod+N",
      "Mod+Alt+J",
    ]);
    await expect(settingsModal(page)).toBeVisible();

    await closeSettings(page);
    const before = await drawingCount(page);
    await page.keyboard.press("Meta+Alt+KeyJ");
    await expect.poll(() => drawingCount(page)).toBe(before + 1);
    await page.waitForTimeout(20);
    await page.keyboard.press("Meta+KeyN");
    await expect.poll(() => drawingCount(page)).toBe(before + 2);

    // Remove the default with the x button: only the new chord works.
    await openHotkeysPage(page);
    await chips(page, "vault.newDrawing")
      .first()
      .getByRole("button", { name: /^Remove / })
      .click();
    await expect(chips(page, "vault.newDrawing")).toHaveCount(1);
    expect((await prefs(page)).hotkeys["vault.newDrawing"]).toEqual([
      "Mod+Alt+J",
    ]);
    await closeSettings(page);
    await page.keyboard.press("Meta+KeyN");
    await page.waitForTimeout(300);
    expect(await drawingCount(page)).toBe(before + 2);
    await page.keyboard.press("Meta+Alt+KeyJ");
    await expect.poll(() => drawingCount(page)).toBe(before + 3);

    // Reset restores exactly the default.
    await openHotkeysPage(page);
    await page
      .getByRole("button", { name: "Reset New drawing to default" })
      .click();
    await expect(chips(page, "vault.newDrawing")).toHaveCount(1);
    expect((await prefs(page)).hotkeys["vault.newDrawing"]).toBeUndefined();
    await closeSettings(page);
    await page.waitForTimeout(20);
    await page.keyboard.press("Meta+KeyN");
    await expect.poll(() => drawingCount(page)).toBe(before + 4);
    await page.waitForTimeout(20);
    await page.keyboard.press("Meta+Alt+KeyJ");
    await page.waitForTimeout(300);
    expect(await drawingCount(page)).toBe(before + 4);
    expect(errors).toEqual([]);
  });

  test("a binding survives a reload", async ({ page }) => {
    await add(page, "Toggle navigator").click();
    await page.keyboard.press("Meta+Alt+KeyB");
    await expect(chips(page, "view.toggleNavigator")).toHaveCount(2);

    await reloadVault(page);
    await page.keyboard.press("Meta+Comma");
    await page.getByRole("tab", { name: "Hotkeys" }).click();
    await expect(chips(page, "view.toggleNavigator")).toHaveCount(2);
    await closeSettings(page);
    const nav = page.getByLabel("Vault file navigator", { exact: true });
    await page.keyboard.press("Meta+Alt+KeyB");
    await expect
      .poll(async () => (await nav.boundingBox())?.width ?? 0)
      .toBeLessThan(2);
  });

  test("recording a chord never executes it", async ({ page }) => {
    // Zoom has no `when` clause, so it would run under Settings if recording leaked.
    await add(page, "New drawing").click();
    await page.keyboard.press("Meta+Shift+Equal");
    await expect(chips(page, "vault.newDrawing")).toHaveCount(2);
    expect((await prefs(page)).zoom ?? 100).toBe(100);

    // Cmd+, belongs to Open settings: recording it keeps Settings as it is.
    const before = await drawingCount(page);
    await add(page, "New drawing").click();
    await page.keyboard.press("Meta+Comma");
    await expect(chips(page, "vault.newDrawing")).toHaveCount(3);
    await expect(settingsModal(page)).toBeVisible();
    await expect(page.locator(".vault-settings-modal")).toHaveCount(1);
    expect(await drawingCount(page)).toBe(before);
    expect((await prefs(page)).zoom ?? 100).toBe(100);
    // ...and the conflicts badge counts each conflicting (command, chord):
    // Mod+Shift+= (New drawing, Zoom in) and Mod+, (New drawing, Open settings).
    await expect(
      page.getByRole("button", { name: /^Conflicts/ }),
    ).toContainText("4");
    await expect(
      settingsModal(page).locator(".vault-hotkeys__row--conflict"),
    ).toHaveCount(3);
  });

  test("Escape cancels recording without closing Settings", async ({
    page,
  }) => {
    await add(page, "New drawing").click();
    await expect(page.getByText("Press keys…")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Press keys…")).toHaveCount(0);
    await expect(settingsModal(page)).toBeVisible();
    expect((await prefs(page)).hotkeys?.["vault.newDrawing"]).toBeUndefined();
    // A second Escape (not recording) closes Settings as usual.
    await page.keyboard.press("Escape");
    await expect(settingsModal(page)).toHaveCount(0);
  });

  for (const [label, chord] of [
    ["Cmd/Ctrl+Q", "Meta+KeyQ"],
    ["Cmd/Ctrl+Shift+W", "Meta+Shift+KeyW"],
  ] as const) {
    test(`refuses the reserved chord ${label} with a message`, async ({
      page,
    }) => {
      // Cmd+Q / Cmd+Shift+W are reserved on macOS; elsewhere Ctrl+Q/W are free, so
      // use a chord reserved on every platform when the page accepts it.
      const isMac = await page.evaluate(() =>
        /Mac/i.test(window.navigator.platform),
      );
      test.skip(!isMac, "Ctrl+Q / Ctrl+Shift+W are only reserved on macOS");
      await add(page, "New drawing").click();
      await page.keyboard.press(chord);
      await expect(page.getByRole("alert")).toContainText(/^Can't use .+: .+/);
      await expect(chips(page, "vault.newDrawing")).toHaveCount(1);
      // Still recording: the next valid key is accepted.
      await page.keyboard.press("Meta+Alt+KeyJ");
      await expect(chips(page, "vault.newDrawing")).toHaveCount(2);
      await expect(page.getByRole("alert")).toHaveCount(0);
    });
  }

  test("inline recording, the conflict sentence naming the winner, and Reset all", async ({
    page,
  }) => {
    // Unassigned rows offer a visible "Add shortcut"; assigned rows only an icon.
    const unassigned = page.locator(".vault-hotkeys__add--text").first();
    await expect(unassigned).toHaveText("Add shortcut");
    await expect(
      row(page, "vault.newDrawing").locator(".vault-hotkeys__add--text"),
    ).toHaveCount(0);

    await add(page, "New drawing").click();
    const pending = row(page, "vault.newDrawing").getByRole("button", {
      name: "Cancel recording",
    });
    await expect(pending).toContainText("Press keys…");
    await expect(pending).toContainText("Esc");
    await expect(pending).toContainText("cancels");
    await page.keyboard.press("Meta+Comma");

    const conflicted = row(page, "vault.newDrawing");
    await expect(conflicted).toHaveClass(/vault-hotkeys__row--conflict/);
    await expect(conflicted.getByTestId("conflict-sentence")).toContainText(
      /Also bound to Open settings\..* wins \(first match\)\./,
    );
    await expect(row(page, "settings.open")).toHaveClass(
      /vault-hotkeys__row--conflict/,
    );

    // Filter chips carry counts; Customised lists the edited command.
    await expect(
      page.getByRole("button", { name: /^Customised/ }),
    ).toContainText("1");
    await page.getByRole("button", { name: /^Customised/ }).click();
    await expect(page.locator(".vault-hotkeys__row")).toHaveCount(1);
    await page.getByRole("button", { name: /^All/ }).click();

    // Reset all asks for a second click, then restores every default.
    const resetAll = page.getByRole("button", { name: /^Reset all/ });
    await resetAll.click();
    await expect(
      page.getByRole("button", { name: /^Reset 1\? Click again/ }),
    ).toBeVisible();
    expect((await prefs(page)).hotkeys["vault.newDrawing"]).toBeDefined();
    await page.getByRole("button", { name: /^Reset 1\?/ }).click();
    await expect(chips(page, "vault.newDrawing")).toHaveCount(1);
    expect((await prefs(page)).hotkeys?.["vault.newDrawing"]).toBeUndefined();
    await expect(page.getByRole("button", { name: /^Conflicts/ })).toHaveCount(
      0,
    );
  });

  test("binding Cmd/Ctrl+, to New drawing shows the conflicts badge and filter", async ({
    page,
  }) => {
    await expect(page.getByRole("button", { name: /^Conflicts/ })).toHaveCount(
      0,
    );
    await add(page, "New drawing").click();
    await page.keyboard.press("Meta+Comma");
    const badge = page.getByRole("button", { name: /^Conflicts/ });
    await expect(badge).toContainText("2");
    await badge.click();
    await expect(row(page, "settings.open")).toBeVisible();
    await expect(row(page, "vault.newDrawing")).toBeVisible();
    await expect(row(page, "file.save")).toHaveCount(0);
    await expect(
      page.locator('.vault-hotkeys__chip-key[data-conflict="true"]'),
    ).toHaveCount(2);
  });
});
