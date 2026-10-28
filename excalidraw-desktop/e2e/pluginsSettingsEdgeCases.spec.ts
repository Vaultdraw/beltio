import { createHash } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { MIDNIGHT_THEME } from "./fixtures/themeServer";
import { seedAndOpen } from "./pageHelpers";
import {
  canvasBox,
  clickMainMenuItem,
  openDrawing,
  openVault,
  readScene,
  reloadVault,
  trackErrors,
} from "./helpers";

// One broad spec for plugins, extensions, settings, commands, keys, themes and profiles (owner,
// 2026-10-28): few tests, each checking many things in one pass, all through visible UI.

const PREFS_KEY = "excalidraw-vault-preferences-v1";

const paletteDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });

/** Opens the palette, types `query`, returns the option texts once the list stops changing, closes it. */
const hits = async (page: Page, query: string): Promise<string[]> => {
  await page.keyboard.press("Meta+Shift+KeyP");
  await expect(paletteDialog(page)).toBeVisible();
  await expect(paletteDialog(page).locator("input").first()).toBeFocused();
  await page.keyboard.type(query);
  const options = paletteDialog(page).getByRole("option");
  let last = "";
  let texts: string[] = [];
  for (let i = 0; i < 40; i++) {
    texts = await options.allTextContents();
    const now = texts.join("|");
    if (now === last && i > 3) {
      break;
    }
    last = now;
    await page.waitForTimeout(60);
  }
  await page.keyboard.press("Escape");
  await expect(paletteDialog(page)).toHaveCount(0);
  return texts;
};

const prefs = (page: Page) =>
  page.evaluate(
    (k) => JSON.parse(window.localStorage.getItem(k) ?? "{}"),
    PREFS_KEY,
  );

const settingsModal = (page: Page) => page.locator(".vault-settings-modal");

const openSettingsTab = async (page: Page, tab: string) => {
  if ((await settingsModal(page).count()) === 0) {
    await page.keyboard.press("Meta+Comma");
    await expect(settingsModal(page)).toBeVisible();
  }
  await settingsModal(page).getByRole("tab", { name: tab }).click();
};

const closeSettings = async (page: Page) => {
  await page.keyboard.press("Escape");
  await expect(settingsModal(page)).toHaveCount(0);
};

const openGraphsDrawing = async (page: Page, query = "?seed=tags") => {
  await openVault(page, query);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
};

/** After a reload the DSA folder is already expanded (saved), so clicking it would collapse it. */
const openGraphsAgain = async (page: Page) => {
  const graphs = page.locator(".vault-tree-item__name", { hasText: "Graphs" });
  if ((await graphs.count()) === 0) {
    await page.locator(".vault-tree-item__name", { hasText: "DSA" }).first().click();
  }
  await openDrawing(page, "Graphs");
};

interface OfficialCase {
  id: string;
  /** What the palette is searched for, and which result proves the plugin is on. */
  query: string;
  match: RegExp;
  /** The activity bar button the plugin adds, when it adds one. */
  bar?: string;
  /** Switched on the Extensions page (the `[extensions]` key) instead of the Plugins page. */
  extension?: string;
}

const OFFICIAL: OfficialCase[] = [
  { id: "gallery", query: "Gallery", match: /^Gallery: Toggle grid view/, bar: "activity-bar-gallery" },
  { id: "favourites", query: "Favourites", match: /^Favourites: Open favourite 1/, bar: "activity-bar-favourites.list" },
  { id: "frames", query: "Frames", match: /^Frames: Present from the first frame/, bar: "activity-bar-frames.list" },
  { id: "formula", query: "Formula", match: /^Formula: Insert formula/ },
  { id: "pdf-import", query: "Import: PDF", match: /^Import: PDF…/, extension: "pdf-import" },
  { id: "auto-export", query: "Auto-export", match: /^Auto-export: Export all drawings now/ },
  { id: "table", query: "Insert table", match: /^Insert table from clipboard/ },
  { id: "markdown-import", query: "Import: Markdown", match: /^Import: Markdown…/ },
  { id: "graph", query: "Graph: Open", match: /^Graph: Open graph view/, bar: "activity-bar-graph", extension: "graph" },
];

test("every official plugin: off, on, off and on again in one session leaves no UI or commands behind", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openGraphsDrawing(page);

  const isOn = async (c: OfficialCase) => {
    const texts = await hits(page, c.query);
    return texts.some((t) => c.match.test(t));
  };
  const flip = async (c: OfficialCase) => {
    await openSettingsTab(page, c.extension ? "Extensions" : "Plugins");
    const row = c.extension
      ? page.getByTestId(`extension-row-${c.extension}`)
      : page.getByTestId(`plugin-${c.id}`);
    await row.getByRole("switch").click({ force: true });
    await closeSettings(page);
  };

  // The official plugins' stubs register just after the app mounts.
  await expect
    .poll(async () => (await hits(page, "Gallery")).length, { timeout: 15_000 })
    .toBeGreaterThan(0);
  // Everything starts on.
  for (const c of OFFICIAL) {
    expect(await isOn(c), `${c.id} on at start`).toBe(true);
    if (c.bar) {
      await expect(page.getByTestId(c.bar), `${c.id} button`).toBeVisible();
    }
  }

  for (const round of [1]) {
    for (const c of OFFICIAL) {
      await flip(c);
      expect(await isOn(c), `${c.id} off (round ${round})`).toBe(false);
      if (c.bar) {
        await expect(page.getByTestId(c.bar), `${c.id} button gone`).toHaveCount(0);
      }
      // The others are untouched.
      for (const other of OFFICIAL.filter((o) => o !== c && o.id === "gallery")) {
        expect(await isOn(other), `${other.id} unaffected by ${c.id}`).toBe(true);
      }
      await flip(c);
      expect(await isOn(c), `${c.id} on again (round ${round})`).toBe(true);
      if (c.bar) {
        await expect(page.getByTestId(c.bar), `${c.id} button back`).toBeVisible();
      }
    }
  }
  const saved = await prefs(page);
  expect(saved.pluginsDisabled).toEqual([]);
  // Back on means working, not just listed.
  await page.getByTestId("activity-bar-gallery").click();
  await expect(page.getByTestId("gallery-view")).toBeVisible();
  await page.getByTestId("activity-bar-gallery").click();
  await expect(page.getByTestId("gallery-view")).toHaveCount(0);
  await page.getByTestId("activity-bar-frames.list").click();
  await expect(page.getByTestId("frames-panel")).toBeVisible();
  expect(errors).toEqual([]);
});

test("an old plugins.enabled list upgrades, a disabled list is kept, and Restore defaults turns everything back on", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openGraphsDrawing(page);
  const setPrefs = (patch: Record<string, unknown>) =>
    page.evaluate(
      ([k, p]) => {
        const old = JSON.parse(window.localStorage.getItem(k as string) ?? "{}");
        window.localStorage.setItem(
          k as string,
          JSON.stringify({ ...old, ...(p as object) }),
        );
      },
      [PREFS_KEY, patch] as const,
    );
  const present = async (query: string, match: RegExp) =>
    (await hits(page, query)).some((t) => match.test(t));
  await expect
    .poll(() => present("Frames", /^Frames: Present/), { timeout: 15_000 })
    .toBe(true);

  // 1. An 0.1.x config: only the gallery and a third-party plugin listed, no plugins.disabled.
  await setPrefs({ pluginsEnabled: ["gallery", "my-third-party"] });
  delete (await prefs(page)).pluginsDisabled;
  await page.evaluate((k) => {
    const p = JSON.parse(window.localStorage.getItem(k) ?? "{}");
    delete p.pluginsDisabled;
    window.localStorage.setItem(k, JSON.stringify(p));
  }, PREFS_KEY);
  await reloadVault(page);
  const upgraded = await prefs(page);
  expect(upgraded.pluginsEnabled).toEqual(
    expect.arrayContaining(["gallery", "my-third-party", "frames", "table", "markdown-import", "graph"]),
  );
  expect(upgraded.pluginsDisabled).toEqual([]);
  await openGraphsAgain(page);
  await expect
    .poll(() => present("Frames", /^Frames: Present/), { timeout: 15_000 })
    .toBe(true);

  // 2. Some plugins and extensions off on purpose: they stay off across a restart.
  await setPrefs({
    pluginsEnabled: ["gallery", "my-third-party"],
    pluginsDisabled: ["frames", "table"],
    extFormula: false,
    extGraph: false,
  });
  await reloadVault(page);
  await openGraphsAgain(page);
  await expect
    .poll(() => present("Gallery", /^Gallery: Toggle/), { timeout: 15_000 })
    .toBe(true);
  expect(await present("Frames", /^Frames:/)).toBe(false);
  expect(await present("Insert table", /^Insert table/)).toBe(false);
  expect(await present("Formula", /^Formula:/)).toBe(false);
  expect(await present("Graph: Open", /^Graph:/)).toBe(false);
  await expect(page.getByTestId("activity-bar-graph")).toHaveCount(0);
  await expect(page.getByTestId("activity-bar-frames.list")).toHaveCount(0);
  expect((await prefs(page)).pluginsEnabled).toContain("my-third-party");

  // 3. Restore defaults on the Extensions page brings every official one back, keeps the third-party one.
  await openSettingsTab(page, "Extensions");
  await settingsModal(page).getByRole("button", { name: "Restore defaults" }).click();
  await closeSettings(page);
  await expect(page.getByTestId("activity-bar-graph")).toBeVisible();
  await expect(page.getByTestId("activity-bar-frames.list")).toBeVisible();
  expect(await present("Frames", /^Frames: Present/)).toBe(true);
  expect(await present("Insert table", /^Insert table/)).toBe(true);
  expect(await present("Formula", /^Formula: Insert/)).toBe(true);
  expect(await present("Graph: Open", /^Graph: Open graph view/)).toBe(true);
  const restored = await prefs(page);
  expect(restored.pluginsDisabled).toEqual([]);
  expect(restored.pluginsEnabled).toContain("my-third-party");
  expect(restored.extFormula && restored.extGraph).toBe(true);
  expect(errors).toEqual([]);
});

test("plugin permission review, consent, a crashing plugin and the registry browser (refused, failing, then allowed)", async ({
  page,
}) => {
  const errors = trackErrors(page);
  // The registry fixture: the index fails once, one package has the wrong checksum.
  const BASE = "/Vaultdraw/plugin-registry/main/";
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const good = Buffer.from("fixture package: word-count 1.0.0");
  const tampered = Buffer.from("fixture package: tampered 1.0.0");
  const requested: string[] = [];
  let indexFailures = 1;
  await page.route("https://raw.githubusercontent.com/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    requested.push(path);
    const headers = { "access-control-allow-origin": "*" };
    if (path === `${BASE}index.json`) {
      if (indexFailures-- > 0) {
        return route.fulfill({ status: 500, headers, body: "boom" });
      }
      return route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({
          schema: 1,
          plugins: [
            { id: "word-count", name: "Word count", author: "ada", description: "Counts words.", version: "1.0.0", api: 0, permissions: ["vault.read"], sha256: sha(good), url: "packages/word-count-1.0.0.zip" },
            { id: "tampered", name: "Tampered", author: "eve", description: "Wrong checksum.", version: "1.0.0", api: 0, permissions: ["vault.read", "vault.write"], sha256: sha(Buffer.from("something else")), url: "packages/tampered-1.0.0.zip" },
          ],
        }),
      });
    }
    if (path === `${BASE}packages/word-count-1.0.0.zip`) {
      return route.fulfill({ status: 200, headers, body: good });
    }
    if (path === `${BASE}packages/tampered-1.0.0.zip`) {
      return route.fulfill({ status: 200, headers, body: tampered });
    }
    return route.fulfill({ status: 404, headers, body: "not found" });
  });

  await openVault(page, "?plugins=hello,writer,crashy&enabled=none");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await openSettingsTab(page, "Plugins");
  const row = (id: string) => page.getByTestId(`plugin-${id}`);
  const sw = (id: string, name: string) =>
    row(id).getByRole("switch", { name: `Enable ${name}` });

  // Review: a plugin with new permissions says so; Cancel leaves it off and its commands absent.
  await expect(row("writer")).toContainText("Needs review");
  await expect(row("hello")).toContainText("Unverified");
  await sw("writer", "Writer").click({ force: true });
  const consent = page.getByRole("dialog", { name: "Enable Writer?" });
  await expect(consent).toContainText("Create drawings and write export images in your vault");
  await consent.getByRole("button", { name: "Cancel" }).click();
  await expect(consent).toHaveCount(0);
  await expect(sw("writer", "Writer")).not.toBeChecked();
  expect((await prefs(page)).pluginsEnabled ?? []).not.toContain("writer");
  // The Review button reaches the same dialog; accepting clears the notice.
  await row("writer").getByRole("button", { name: "Review Writer" }).click();
  await page
    .getByRole("dialog", { name: /Writer/ })
    .getByRole("button", { name: /^(Enable|Accept|Allow|Confirm)/ })
    .first()
    .click();
  await expect(row("writer")).not.toContainText("Needs review");

  // Enable the other two through consent.
  for (const [id, name] of [["hello", "Hello"], ["crashy", "Crashy"]]) {
    await sw(id, name).click({ force: true });
    await page
      .getByRole("dialog", { name: new RegExp(`Enable ${name}`) })
      .getByRole("button", { name: "Enable", exact: true })
      .click();
    await expect(sw(id, name)).toBeChecked();
  }
  await closeSettings(page);

  // A plugin that throws three times is switched off with a notice; the app and other plugins carry on.
  for (let run = 0; run < 3; run++) {
    await page.keyboard.press("Meta+Shift+KeyP");
    await page.keyboard.type("explode");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      (n) =>
        ((window as any).__plugins.getPluginCosts() as any[]).find((c) => c.id === "crashy")?.handlerMs.length >= n,
      run + 1,
    );
  }
  await expect(page.getByText(/Plugin Crashy was disabled: 3 errors/)).toBeVisible();
  expect((await hits(page, "explode")).filter((t) => /Crashy/.test(t))).toEqual([]);
  expect((await hits(page, "say hello")).some((t) => /^Hello: say hello/.test(t))).toBe(true);
  await page.keyboard.press("Meta+Shift+KeyP");
  await page.keyboard.type("say hello");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Hello from a plugin")).toBeVisible();
  await openSettingsTab(page, "Plugins");
  await expect(row("crashy")).toContainText("Disabled by Vaultdraw");
  await expect(sw("crashy", "Crashy")).toBeDisabled();
  await row("crashy").getByRole("button", { name: "Re-enable Crashy" }).click();
  await expect(row("crashy")).not.toContainText("Disabled by Vaultdraw");

  // Registry browser: nothing is requested until Allow; the first index fetch fails and Try again works.
  await page.getByRole("button", { name: "Browse community plugins…" }).click();
  const browser = page.getByTestId("plugin-browser-dialog");
  await expect(browser.getByTestId("plugin-browser-consent")).toBeVisible();
  await browser.getByRole("button", { name: "Not now" }).click();
  await expect(browser).toHaveCount(0);
  expect(requested).toEqual([]);
  await page.getByRole("button", { name: "Browse community plugins…" }).click();
  await browser.getByRole("button", { name: "Allow" }).click();
  await expect(browser.getByRole("alert")).toBeVisible();
  await browser.getByRole("button", { name: "Try again" }).click();
  const list = browser.getByRole("listbox", { name: "Community plugins" });
  await expect(list.getByRole("option")).toHaveCount(2);
  // A package whose checksum differs is refused and nothing is installed.
  await browser.getByLabel("Search plugins").fill("tampered");
  await expect(browser.getByTestId("plugin-browser-permissions")).toContainText("Create drawings and write export images");
  await browser.getByRole("button", { name: "Install", exact: true }).click();
  await expect(browser.getByRole("alert")).toBeVisible();
  await expect(list.getByRole("option", { name: /Tampered/ })).not.toContainText("Installed");
  await browser.getByLabel("Search plugins").fill("word");
  await browser.getByRole("button", { name: "Install", exact: true }).click();
  await expect(page.getByText("Installed Word count")).toBeVisible();
  // Allow was saved: reopening goes straight to the list.
  expect((await prefs(page)).networkAllowPlugins).toBe(true);
  // Only the failures this test caused on purpose: the crashing plugin and the failing downloads.
  expect(errors.filter((e) => !/kaboom|500|checksum|Failed to load resource/i.test(e))).toEqual([]);
});

/** Is the toolbar's `name` tool the active one. */
const toolActive = (page: Page, name: string) =>
  page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(
      `.vault-editor [data-testid='toolbar-${id}']`,
    );
    if (!el) {
      return null;
    }
    const input = el instanceof HTMLInputElement ? el : el.querySelector("input");
    if (input) {
      return input.checked;
    }
    return (
      el.classList.contains("selected") ||
      el.classList.contains("is-selected") ||
      el.getAttribute("aria-checked") === "true" ||
      el.getAttribute("data-state") === "on" ||
      el.getAttribute("aria-pressed") === "true"
    );
  }, name);

const hotkeyRow = (page: Page, id: string) =>
  page.locator(`.vault-hotkeys__row[data-command-id="${id}"]`);

test("commands and keys: every command is listed and rebindable, old ids still bind, sequences, prefixes and conflicts behave", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openGraphsDrawing(page);
  await expect
    .poll(() => hits(page, "Gallery").then((t) => t.length), { timeout: 15_000 })
    .toBeGreaterThan(0);

  // 1. The palette reaches a spread of commands from every area (a typed query, no shortcut).
  const SAMPLE = [
    "Save", "Tabs: Close tab", "Search", "Tags: Focus tags pane", "Templates: Open the global templates folder",
    "Extensions: Toggle Graph view", "Extensions: Toggle Formulas", "Gallery: Toggle grid view", "Favourites: Open favourite 1",
    "Frames: Present from the current frame", "Formula: Insert formula", "Import: Markdown…", "Import: PDF…", "Graph: Open graph view",
    "Insert table from clipboard", "Auto-export: Export all drawings now", "Plugins: Open plugin settings", "View: Focus mode",
    "Layout: Default layout", "Themes: Remove an installed theme", "Tool: Rectangle", "Tool: Ellipse", "Open settings",
    "Navigator: Focus file tree", "Config: Reload config files",
  ];
  const input = () => paletteDialog(page).locator("input").first();
  await page.keyboard.press("Meta+Shift+KeyP");
  await expect(input()).toBeFocused();
  const unreachable: string[] = [];
  for (const title of SAMPLE) {
    await input().fill(`>${title}`);
    const ok = await expect
      .poll(async () => (await paletteDialog(page).getByRole("option").allTextContents()).some((t) => t.startsWith(title)), { timeout: 1500 })
      .toBe(true)
      .then(() => true, () => false);
    if (!ok) {
      unreachable.push(title);
    }
  }
  await page.keyboard.press("Escape");
  expect(unreachable).toEqual([]);

  // 2. The Hotkeys page lists every command once, each with an Add button: all are rebindable.
  await openSettingsTab(page, "Hotkeys");
  const listing = await page.locator(".vault-hotkeys__row").evaluateAll((rows) =>
    rows.map((r) => ({
      id: r.getAttribute("data-command-id"),
      add: r.querySelector('button[aria-label^="Add hotkey for"]') !== null,
    })),
  );
  expect(listing.length).toBeGreaterThan(300);
  expect(new Set(listing.map((r) => r.id)).size).toBe(listing.length);
  expect(listing.filter((r) => !r.add).map((r) => r.id)).toEqual([]);
  await closeSettings(page);

  // 3. Keys saved under old command ids still bind to the renamed commands.
  await page.evaluate((k) => {
    const p = JSON.parse(window.localStorage.getItem(k) ?? "{}");
    p.hotkeys = {
      ...(p.hotkeys ?? {}),
      "thumbnails.galleryToggle": ["Alt+Shift+Q"],
      "thumbnails.galleryOpen": ["Alt+Shift+W"],
      "file.importPdf": ["Alt+Shift+E"],
    };
    window.localStorage.setItem(k, JSON.stringify(p));
  }, PREFS_KEY);
  await reloadVault(page);
  await openGraphsAgain(page);
  await openSettingsTab(page, "Hotkeys");
  await page.getByLabel("Filter hotkeys").fill("Gallery");
  await expect(hotkeyRow(page, "gallery.toggle")).toContainText("Q");
  await expect(hotkeyRow(page, "gallery.show-folder")).toContainText("W");
  await page.getByLabel("Filter hotkeys").fill("PDF");
  await expect(hotkeyRow(page, "pdf-import.import")).toContainText("E");
  await closeSettings(page);
  await page.keyboard.press("Alt+Shift+Q");
  await expect(page.getByTestId("gallery-view")).toBeVisible();
  await page.keyboard.press("Alt+Shift+Q");
  await expect(page.getByTestId("gallery-view")).toHaveCount(0);

  // 4. Sequences: "g r" is Rectangle, a lone "g" is Ellipse; the shorter one is flagged as a prefix warning.
  const bind = async (title: string, keys: string[], sequence: boolean) => {
    await openSettingsTab(page, "Hotkeys");
    await page.getByLabel("Filter hotkeys").fill(title);
    await page.getByRole("button", { name: `Add hotkey for ${title}`, exact: true }).click();
    if (sequence) {
      await page.getByRole("button", { name: "Sequence", exact: true }).click();
    }
    for (const k of keys) {
      await (sequence ? page.keyboard.type(k) : page.keyboard.press(k));
    }
    if (sequence) {
      await page.keyboard.press("Enter");
    }
  };
  await bind("Tool: Rectangle", ["g", "r"], true);
  await bind("Tool: Ellipse", ["g"], true);
  await page.getByLabel("Filter hotkeys").fill("Tool: Ellipse");
  await expect(hotkeyRow(page, "tool.ellipse")).toHaveClass(/vault-hotkeys__row--conflict/);
  await expect(hotkeyRow(page, "tool.ellipse").getByTestId("conflict-sentence")).toBeVisible();
  await closeSettings(page);

  await page.locator(".vault-editor [data-testid='toolbar-diamond']").click();
  await expect.poll(() => toolActive(page, "diamond")).toBe(true);
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8);
  // The full sequence.
  await page.keyboard.press("g");
  await expect(page.getByRole("status", { name: "Key sequence options" })).toBeVisible();
  await page.keyboard.press("r");
  await expect.poll(() => toolActive(page, "rectangle")).toBe(true);
  // Escape cancels a pending sequence: nothing runs.
  await page.locator(".vault-editor [data-testid='toolbar-diamond']").click();
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8);
  await page.keyboard.press("g");
  await expect(page.getByRole("status", { name: "Key sequence options" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status", { name: "Key sequence options" })).toHaveCount(0);
  await page.waitForTimeout(150);
  expect(await toolActive(page, "rectangle")).toBe(false);
  expect(await toolActive(page, "ellipse")).toBe(false);
  // A lone "g" waits for the timeout, then runs the shorter binding (Ellipse).
  await page.keyboard.press("g");
  await expect.poll(() => toolActive(page, "ellipse"), { timeout: 5000 }).toBe(true);

  // 5. A chord bound to two commands is a conflict on both rows, and Reset all removes the lot.
  await bind("Tool: Diamond", ["Meta+Comma"], false);
  await page.getByLabel("Filter hotkeys").fill("");
  await page.getByRole("button", { name: /^Conflicts/ }).click();
  await expect(hotkeyRow(page, "settings.open")).toBeVisible();
  await expect(hotkeyRow(page, "tool.diamond")).toBeVisible();
  await page.getByRole("button", { name: /^All/ }).click();
  await page.getByRole("button", { name: /^Reset all/ }).click();
  await page.getByRole("button", { name: /^Reset \d+\? Click again/ }).click();
  expect(Object.keys((await prefs(page)).hotkeys ?? {})).toEqual([]);
  expect(errors).toEqual([]);
});

test("focus mode with every panel open: chrome hides, panels stay, Esc and dialogs behave, focus.hide is honoured", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openGraphsDrawing(page);
  await expect
    .poll(() => hits(page, "Gallery").then((t) => t.length), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const header = page.locator("header.vault-header");
  const navigator = page.getByLabel("Vault File Navigator");
  const bar = page.getByTestId("activity-bar-settings");
  const chromeShown = async (on: boolean) => {
    for (const part of [header, navigator, bar]) {
      await (on ? expect(part).toBeVisible() : expect(part).toBeHidden());
    }
  };

  const PANELS: { bar: string; panel: () => ReturnType<Page["locator"]>; overlay?: boolean }[] = [
    { bar: "activity-bar-library", panel: () => page.locator(".default-sidebar") },
    { bar: "activity-bar-history", panel: () => page.locator(".vault-history-panel") },
    { bar: "activity-bar-favourites.list", panel: () => page.getByTestId("favourites-panel") },
    { bar: "activity-bar-frames.list", panel: () => page.getByTestId("frames-panel") },
    { bar: "activity-bar-gallery", panel: () => page.getByTestId("gallery-view"), overlay: true },
    { bar: "activity-bar-graph", panel: () => page.getByTestId("graph-view"), overlay: true },
  ];
  for (const p of PANELS) {
    await page.getByTestId(p.bar).click();
    await expect(p.panel(), `${p.bar} opens`).toBeVisible();
    await chromeShown(true);

    // The key (a click on the editor's menu would close Excalidraw's own library sidebar).
    await page.keyboard.press("Meta+Shift+Enter");
    await chromeShown(false);
    // The drawing toolbar and the panel you opened yourself stay.
    if (!p.overlay) {
      await expect(page.locator(".App-toolbar").first()).toBeVisible();
    }
    await expect(p.panel(), `${p.bar} stays in focus mode`).toBeVisible();

    // Esc leaves focus mode (an overlay that has the focus takes the first Esc, as it does everywhere).
    for (let i = 0; i < 3 && !(await header.isVisible()); i++) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(120);
    }
    await chromeShown(true);
    if (await p.panel().isVisible()) {
      await page.getByTestId(p.bar).click();
    }
    await expect(p.panel(), `${p.bar} closes`).toHaveCount(0);
  }

  // A dialog opened in focus mode takes the Esc first; focus mode stays until the next Esc.
  await clickMainMenuItem(page, "Focus mode");
  await chromeShown(false);
  await page.keyboard.press("Meta+Comma");
  await expect(settingsModal(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settingsModal(page)).toHaveCount(0);
  await chromeShown(false);
  await page.keyboard.press("Escape");
  await chromeShown(true);

  // focus.hide: only the header goes; the navigator and the activity bar stay.
  await page.evaluate((k) => {
    const prefsNow = JSON.parse(window.localStorage.getItem(k) ?? "{}");
    window.localStorage.setItem(k, JSON.stringify({ ...prefsNow, focusHide: ["header"] }));
  }, PREFS_KEY);
  await reloadVault(page);
  await openGraphsAgain(page);
  await clickMainMenuItem(page, "Focus mode");
  await expect(header).toBeHidden();
  await expect(navigator).toBeVisible();
  await expect(bar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(header).toBeVisible();
  expect(errors).toEqual([]);
});

test("config.toml edits reload live: plugins, extensions and keys follow, a broken file is named and nothing is lost", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    (window as any).__e2eConfig = {
      extensions: { graph: false },
      plugins: { disabled: ["frames"] },
      hotkeys: { "gallery.toggle": ["Alt+Shift+Q"] },
      interface: { thumbnails: false },
    };
  });
  await openGraphsDrawing(page, "?seed=tags&config=1");
  const graphButton = page.getByTestId("activity-bar-graph");
  const framesButton = page.getByTestId("activity-bar-frames.list");
  const galleryGrid = page.getByTestId("gallery-view");
  await expect(page.getByTestId("activity-bar-gallery")).toBeVisible();
  // What config.toml says is in force from the start.
  await expect(graphButton).toHaveCount(0);
  await expect(framesButton).toHaveCount(0);
  await page.keyboard.press("Alt+Shift+Q");
  await expect(galleryGrid).toBeVisible();
  await page.keyboard.press("Alt+Shift+Q");
  await expect(galleryGrid).toHaveCount(0);

  const reload = async () => {
    await openSettingsTab(page, "General");
    await settingsModal(page).getByRole("button", { name: "Reload" }).click();
  };
  const problems = () =>
    settingsModal(page).getByRole("list", { name: "Problems in config files" });

  // The user edits the file: everything switches live.
  await page.evaluate(() => {
    (window as any).__e2eConfig = {};
  });
  await reload();
  await closeSettings(page);
  await expect(graphButton).toBeVisible();
  await expect(framesButton).toBeVisible();
  await page.keyboard.press("Alt+Shift+Q");
  await page.waitForTimeout(250);
  await expect(galleryGrid).toHaveCount(0);

  // A wrong value is a warning that names the key; the rest of the file still applies.
  await page.evaluate(() => {
    (window as any).__e2eConfig = {
      extensions: { graph: "yes", formula: false },
      plugins: { disabled: ["frames"] },
    };
  });
  await reload();
  await expect(problems().getByRole("listitem").first()).toContainText("extensions.graph");
  await closeSettings(page);
  await expect(graphButton).toBeVisible();
  await expect(framesButton).toHaveCount(0);
  expect(await hits(page, "Formula: Insert")).toEqual([]);

  // Invalid TOML: a clear error with the line, the last good settings stay, and Settings still saves.
  await page.evaluate(() => {
    (window as any).__e2eConfig = { extensions: { graph: false } };
    (window as any).__e2eConfigError = { message: "expected a value after `=`", line: 3 };
  });
  await reload();
  await expect(problems().getByRole("listitem")).toHaveText([
    "config.toml line 3: expected a value after `=`",
  ]);
  await openSettingsTab(page, "Extensions");
  await expect(page.getByTestId("extension-row-graph").getByRole("switch")).toBeChecked();
  await page.getByTestId("extension-row-gallery").locator(".vault-switch").click();
  await closeSettings(page);
  await expect(graphButton).toBeVisible();
  await expect(page.getByTestId("activity-bar-gallery")).toHaveCount(0);
  // The user fixes the file: the error clears and the new values apply.
  await page.evaluate(() => {
    (window as any).__e2eConfigError = null;
  });
  await reload();
  await expect(problems()).toHaveCount(0);
  await closeSettings(page);
  await expect(graphButton).toHaveCount(0);
  // The Settings change made during the error survived.
  await expect(page.getByTestId("activity-bar-gallery")).toHaveCount(0);
  expect(errors).toEqual([]);
});

const rootVar = (page: Page, name: string) =>
  page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );
const themeName = (page: Page) =>
  page.evaluate(() => document.documentElement.dataset.vaultTheme ?? "");

test("themes: switch, browse, install from a URL with the network refused and then allowed", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const requests: string[] = [];
  page.on("request", (r) => {
    if (/e2e-themes|raw\.githubusercontent/.test(r.url())) {
      requests.push(new URL(r.url()).pathname);
    }
  });
  const DAYBREAK = JSON.stringify({
    name: "Daybreak",
    author: "E2E",
    light: { mPrimary: "#d9480f", mOnPrimary: "#ffffff", mSurface: "#fff8f0", mOnSurface: "#2b2118" },
  });
  const sha = (t: string) => createHash("sha256").update(t).digest("hex");
  await page.route("**/e2e-themes/Broken.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{ not json" }),
  );
  await page.route("**/e2e-themes/Missing.json", (route) =>
    route.fulfill({ status: 404, body: "not found" }),
  );
  await page.route("https://raw.githubusercontent.com/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const files: Record<string, string> = {
      "/Vaultdraw/themes/main/index.json": JSON.stringify({
        schemaVersion: 1,
        themes: [
          { name: "Daybreak", path: "Daybreak/Daybreak.json", author: "E2E", description: "Warm light", tags: ["light"], modes: ["light"], swatch: { light: ["#fff8f0", "#2b2118", "#d9480f"] }, sha256: sha(DAYBREAK), previews: [] },
          { name: "Tampered", path: "Tampered/Tampered.json", author: "E2E", description: "Wrong checksum", tags: ["dark"], modes: ["dark"], swatch: { dark: ["#000000", "#ffffff", "#ff0000"] }, sha256: sha("something else"), previews: [] },
        ],
      }),
      "/Vaultdraw/themes/main/Daybreak/Daybreak.json": DAYBREAK,
      "/Vaultdraw/themes/main/Tampered/Tampered.json": MIDNIGHT_THEME,
    };
    const body = files[path];
    return route.fulfill(
      body === undefined
        ? { status: 404, body: "not found" }
        : { status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body },
    );
  });
  await openGraphsDrawing(page);
  const defaultBg = await rootVar(page, "--vault-bg");
  await openSettingsTab(page, "Appearance");
  const radio = (name: string) => settingsModal(page).getByRole("radio", { name, exact: true });

  // Switch between built-in themes, and back.
  await radio("Dracula").click();
  await expect(radio("Dracula")).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => themeName(page)).toBe("Dracula");
  const draculaBg = await rootVar(page, "--vault-bg");
  expect(draculaBg).not.toBe(defaultBg);
  await radio("Default").click();
  await expect.poll(() => themeName(page)).not.toBe("Dracula");
  await expect.poll(() => rootVar(page, "--vault-bg")).toBe(defaultBg);
  expect((await prefs(page)).colorTheme).toBe("Default");

  // Install from URL: refuse the network first; nothing is requested, nothing saved.
  await settingsModal(page).getByRole("button", { name: "Install from URL..." }).click();
  const install = page.getByTestId("theme-install-dialog");
  await expect(install.getByTestId("theme-install-consent")).toBeVisible();
  await install.getByRole("button", { name: "Not now" }).click();
  await expect(install).toHaveCount(0);
  expect(requests).toEqual([]);
  expect((await prefs(page)).networkAllowThemes).not.toBe(true);
  // The theme browser asks too, and also refuses cleanly.
  await settingsModal(page).getByRole("button", { name: "Install more themes..." }).click();
  const browser = page.getByTestId("theme-browser-dialog");
  await expect(browser.getByTestId("theme-browser-consent")).toBeVisible();
  await browser.getByRole("button", { name: "Not now" }).click();
  await expect(browser).toHaveCount(0);
  expect(requests).toEqual([]);

  // Allow once: bad addresses give a message, a good one installs and applies.
  await settingsModal(page).getByRole("button", { name: "Install from URL..." }).click();
  await install.getByRole("button", { name: "Allow" }).click();
  const origin = new URL(page.url()).origin;
  for (const bad of ["Missing.json", "Broken.json"]) {
    await install.getByLabel("Address or GitHub repo").fill(`${origin}/e2e-themes/${bad}`);
    await install.getByRole("button", { name: "Look up" }).click();
    await expect(install.getByRole("alert")).toBeVisible();
  }
  await install.getByLabel("Address or GitHub repo").fill(`${origin}/e2e-themes/Midnight.json`);
  await install.getByRole("button", { name: "Look up" }).click();
  await install.getByRole("button", { name: "Install", exact: true }).click();
  await expect(install.getByTestId("theme-install-done")).toContainText("Midnight");
  await install.getByRole("button", { name: "Use it" }).click();
  await expect.poll(() => themeName(page)).toBe("Midnight");
  expect((await prefs(page)).networkAllowThemes).toBe(true);

  // The browser no longer asks: it lists, filters, refuses a bad checksum and installs a good theme.
  requests.length = 0;
  await settingsModal(page).getByRole("button", { name: "Install more themes..." }).click();
  await expect(browser.getByTestId("theme-browser-consent")).toHaveCount(0);
  await expect(browser.getByTestId("theme-browser-status")).toContainText("2 of 2 themes");
  await browser.getByLabel("Search themes").fill("zzz-nothing");
  await expect(browser.getByTestId("theme-browser-status")).toContainText("0 of 2 themes");
  await browser.getByLabel("Search themes").fill("");
  await browser.getByTestId("theme-card-Tampered").getByRole("button", { name: "Install", exact: true }).click();
  await expect(browser.getByTestId("theme-card-Tampered")).not.toContainText("Installed");
  await browser.getByTestId("theme-card-Daybreak").getByRole("button", { name: "Install", exact: true }).click();
  await expect(browser.getByTestId("theme-card-Daybreak")).toContainText("Installed");
  await browser.getByTestId("theme-card-Daybreak").getByRole("button", { name: "Use", exact: true }).click();
  await expect.poll(() => themeName(page)).toBe("Daybreak");
  expect(requests[0]).toBe("/Vaultdraw/themes/main/index.json");
  expect(errors.filter((e) => !/404|Failed to load resource|checksum|JSON/i.test(e))).toEqual([]);
});

test("profiles: create, switch live, per vault, bad names refused and delete falls back to default", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    // What the "talk" profile's config.toml says (its folder is made in the test).
    (window as any).__e2eProfileConfigs = {
      talk: { extensions: { graph: false }, plugins: { disabled: ["frames"] } },
    };
  });
  await openGraphsDrawing(page, "?seed=tags&config=1");
  const graphButton = page.getByTestId("activity-bar-graph");
  const framesButton = page.getByTestId("activity-bar-frames.list");
  await expect(graphButton).toBeVisible();
  const select = () => settingsModal(page).getByLabel("Profile", { exact: true });
  const toasts = page.locator(".vd-toast");

  await openSettingsTab(page, "General");
  await expect(select()).toHaveValue("default");

  // Names are checked as you type: reserved, bad characters, and a duplicate.
  const createProfile = async (name: string) => {
    await settingsModal(page).getByRole("button", { name: "New profile" }).click();
    const form = page.getByRole("dialog", { name: "New profile" });
    await form.getByLabel("Profile name").fill(name);
    return form;
  };
  let form = await createProfile("default");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form.getByRole("alert")).toContainText("Use 1 to 48 letters");
  await form.getByLabel("Profile name").fill("bad name!");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form.getByRole("alert")).toContainText("Use 1 to 48 letters");
  await form.getByLabel("Profile name").fill("talk");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(select()).toHaveValue("talk");
  // The profile's own config applies at once: Graph and Frames are gone.
  await expect(graphButton).toHaveCount(0);
  await expect(framesButton).toHaveCount(0);
  form = await createProfile("Talk");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form.getByRole("alert")).toContainText("already exists");
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toHaveCount(0);

  // A second profile with no changes, then switch back and forth live.
  form = await createProfile("plain");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(select()).toHaveValue("plain");
  await expect(graphButton).toBeVisible();
  await select().selectOption("talk");
  await expect(graphButton).toHaveCount(0);
  await select().selectOption("default");
  await expect(graphButton).toBeVisible();
  await expect(framesButton).toBeVisible();

  // Per vault: the vault names "talk"; after a reload it is active again with a note, and clearing it goes back.
  await select().selectOption("talk");
  await closeSettings(page);
  await page.keyboard.press("Meta+Shift+KeyP");
  await page.keyboard.type("Use the active profile for this vault");
  await page.keyboard.press("Enter");
  await openSettingsTab(page, "General");
  await select().selectOption("default");
  await closeSettings(page);
  await expect(graphButton).toBeVisible();
  await reloadVault(page);
  await expect(toasts.filter({ hasText: 'Profile "talk" (set by this vault).' })).toBeVisible();
  await expect(page.getByTestId("activity-bar-graph")).toHaveCount(0);
  const vaultHandle = await page.evaluate(
    () => Object.keys((window as any).__e2eVaultProfiles ?? {})[0],
  );
  expect(vaultHandle).toBeTruthy();
  await page.keyboard.press("Meta+Shift+KeyP");
  await page.keyboard.type("Stop choosing a profile for this vault");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => Object.keys((window as any).__e2eVaultProfiles ?? {})))
    .toEqual([]);
  // (Going back to the remembered profile needs a second vault: the memory of "your choice" lasts one run.)
  await openSettingsTab(page, "General");
  await select().selectOption("default");
  await closeSettings(page);
  await expect(page.getByTestId("activity-bar-graph")).toBeVisible();
  // A vault that names a profile this machine does not have is ignored with a note.
  await page.evaluate((handle) => {
    window.sessionStorage.setItem(
      "e2e-profiles",
      JSON.stringify({ profiles: ["talk", "plain"], profile: null, configs: (window as any).__e2eProfileConfigs, vault: { [handle]: "ghost" } }),
    );
  }, vaultHandle);
  await reloadVault(page);
  await expect(toasts.filter({ hasText: 'asks for the profile "ghost"' })).toBeVisible();
  await expect(page.getByTestId("activity-bar-graph")).toBeVisible();

  // Delete the active profile: it asks first, then falls back to default.
  await openSettingsTab(page, "General");
  await select().selectOption("talk");
  await expect(page.getByTestId("activity-bar-graph")).toHaveCount(0);
  await settingsModal(page).getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "talk" }).click();
  await page.getByRole("button", { name: "Delete profile" }).click();
  await expect(select()).toHaveValue("default");
  await expect(select().locator("option")).toHaveText(["default", "plain"]);
  await expect(page.getByTestId("activity-bar-graph")).toBeVisible();
  expect(errors).toEqual([]);
});

test("paste-a-table: what counts as a table, Ask / Always / Never, and the plugin off", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await seedAndOpen(page, "Sketch.excalidraw", { elements: [] });
  await expect
    .poll(() => hits(page, "Insert table").then((t) => t.length), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const scene = async () =>
    ((await readScene(page, "Sketch.excalidraw")).elements as any[]).filter((e) => !e.isDeleted);
  const paste = async (text: string) => {
    const box = await canvasBox(page);
    await page.mouse.click(box.x + 200, box.y + 200);
    await page.evaluate((t) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", t);
      document.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    }, text);
  };
  const offer = page.getByText("That looks like a table");
  const noOffer = async (text: string, why: string) => {
    await paste(text);
    await page.waitForTimeout(700);
    await expect(offer, why).toHaveCount(0);
  };
  const setMode = async (mode: string) => {
    await openSettingsTab(page, "Plugins");
    await page.getByTestId("plugin-table").getByRole("button", { name: "Table settings" }).click();
    const label = { ask: "Ask", always: "Always insert a table", never: "Never" }[mode];
    await page
      .getByTestId("plugin-table")
      .getByRole("group", { name: "When you paste a table" })
      .getByRole("button", { name: label, exact: true })
      .click();
    await closeSettings(page);
  };

  // Things that are not tables are left alone.
  await noOffer("just one line of text", "one line");
  await noOffer("Hello, this is a sentence. It has commas, and more commas, but it is prose.", "prose with commas");
  await noOffer("a\tb", "one row of cells");
  await noOffer("a|b", "one pipe row");

  // Never: even a clear table is a plain paste.
  await setMode("never");
  await noOffer("Name\tColour\nApple\tRed\nPear\tGreen", "never mode");

  // Always: the table replaces the paste at once, no toast.
  await setMode("always");
  const before = (await scene()).length;
  await paste("Name\tColour\nApple\tRed\nPear\tGreen");
  await expect.poll(async () => (await scene()).some((e) => e.type === "line"), { timeout: 10_000 }).toBe(true);
  await expect(offer).toHaveCount(0);
  const always = (await scene()).slice(before);
  expect(always.filter((e) => e.type === "text").map((e) => e.text).sort()).toEqual(
    ["Apple", "Green", "Name", "Colour", "Pear", "Red"].sort(),
  );

  // Ask: each kind of table gets the offer; clicking swaps the pasted text for the table.
  await setMode("ask");
  const KINDS: [string, string, string[]][] = [
    ["tab-separated", "A\tB\nx\ty", ["A", "B", "x", "y"]],
    ["markdown pipes", "| Item | Qty |\n| --- | --- |\n| Pen | two |", ["Item", "Qty", "Pen", "two"]],
    ["csv with a quoted comma", 'Name,Note\nAda,"likes a, b"\nGrace,ok', ["Name", "Note", "Ada", "likes a, b", "Grace", "ok"]],
    ["ragged rows (one cell short in five)", "Name\tColour\tSize\nApple\tRed\tS\nPear\tGreen\nFig\tPurple\tL\nPlum\tBlue\tM", ["Name", "Colour", "Size", "Apple", "Red", "S", "Pear", "Green", "Fig", "Purple", "L", "Plum", "Blue", "M"]],
    ["semicolons", "x;y\na;b\nc;d", ["x", "y", "a", "b", "c", "d"]],
  ];
  for (const [kind, text, cells] of KINDS) {
    const count = (await scene()).length;
    await paste(text);
    await expect(offer, kind).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Insert as table" }).click();
    await expect(offer, `${kind} toast closes`).toHaveCount(0);
    await expect
      .poll(async () => (await scene()).slice(count).filter((e) => e.type === "text").map((e) => e.text).sort(), { timeout: 10_000 })
      .toEqual([...cells].sort());
  }

  // Off: the plugin is not listening at all.
  await openSettingsTab(page, "Plugins");
  await page.getByTestId("plugin-table").getByRole("switch").click({ force: true });
  await closeSettings(page);
  expect((await hits(page, "Insert table")).filter((t) => /^Insert table/.test(t))).toEqual([]);
  await noOffer("Name\tColour\nApple\tRed", "table plugin off");
  expect(errors).toEqual([]);
});
