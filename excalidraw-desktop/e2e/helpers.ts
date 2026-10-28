import { expect, type Page } from "@playwright/test";

export const SHOTS = "../.cache/e2e-shots";

/** Debug screenshots are only taken in full runs (E2E_FULL=1). */
export const screenshot = async (
  page: Page,
  options: Parameters<Page["screenshot"]>[0],
) => {
  if (process.env.E2E_FULL === "1") {
    await page.screenshot(options);
  }
};

/**
 * WebKit/Chromium report this when a frame's ResizeObserver callbacks could not
 * all be delivered before paint. It is benign: no persistent layout loop exists.
 * Every ResizeObserver in src/ (rowWindow, useTreeWindow, ChangeOverlay, graph,
 * GalleryView) only reads size and updates state that does not resize the
 * observed element (compare-before-set or rAF-deferred), and the failure did not
 * reproduce in 15 + 60 repeat runs; it appeared once in a full run under load.
 * Opening a docked panel also resizes Excalidraw's own observed container.
 * Filter exactly this message, nothing broader.
 */
const BENIGN_RESIZE_OBSERVER =
  "ResizeObserver loop completed with undelivered notifications.";
const isBenign = (message: string) =>
  message.replace(/\.?$/, ".") === BENIGN_RESIZE_OBSERVER;

/** Collect console errors / page errors so every spec can assert none occurred. */
export const trackErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    if (!isBenign(err.message)) {
      errors.push(`pageerror: ${err.message}`);
    }
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" && !isBenign(msg.text())) {
      errors.push(`console: ${msg.text()}`);
    }
  });
  return errors;
};

/**
 * Waits for the freshly loaded app and lets it into the (fake) vault.
 *
 * The app reopens the last vault by itself right after mount, so the first
 * frames show the onboarding button and then swap it for the navigator. Never
 * "see the button, then click it": the button can vanish in between, and the
 * click then waits for it until the test times out. Wait for the state instead:
 * the navigator is there, or the onboarding button can be clicked.
 */
export const enterVault = async (
  page: Page,
  beforeClick?: () => Promise<void>,
) => {
  const onboarding = page.getByRole("button", { name: /Open vault folder/ });
  const navigator = page.getByLabel("Vault file navigator");
  await expect(async () => {
    if (await navigator.isVisible()) {
      return;
    }
    // Fails (and is polled again) while the page is still loading or when the
    // button vanished because the vault opened by itself; one click is enough.
    // `beforeClick` runs on every poll that still sees the button: keep it
    // repeatable.
    if (await onboarding.isVisible()) {
      await beforeClick?.();
    }
    await onboarding.click({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await expect(navigator).toBeVisible();
};

export const openVault = async (page: Page, query = "") => {
  await page.goto(`/e2e.html${query}`);
  await enterVault(page);
};

/**
 * Reloads the page and waits until the app has booted again. Never follow a
 * `page.reload()` with `openVault` (its `goto`): that navigation cancels the
 * module chunks the reloaded page is still importing, and WebKit reports each
 * as `pageerror: Importing a module script failed` (80 reload+goto loops gave
 * 21 of them). Use this instead.
 */
export const reloadVault = async (page: Page) => {
  await page.reload();
  await enterVault(page);
};

export const openDrawing = async (page: Page, name: string) => {
  const item = page
    .locator(".vault-tree-item__name", { hasText: name })
    .first();
  const path = await item.getAttribute("title");
  await item.click();
  const editor = page.locator(".vault-editor");
  await expect(editor.locator("canvas.interactive")).toBeVisible();
  // The clicked drawing's scene has landed and no swap or load is running:
  // the editor's own state, not a fixed wait.
  if (path) {
    await expect(editor).toHaveAttribute(
      "data-document-id",
      new RegExp(`:${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    );
  }
  await expect(editor).toHaveAttribute("data-scene-ready", "true");
  await expect(editor).toHaveAttribute("data-loading", "false");
};

/** Read a drawing's JSON straight from the in-memory vault. */
export const readScene = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const repo = (window as any).__vaultRepo;
    const file = await repo.readDrawing(repo.handle, p);
    return JSON.parse(file.json);
  }, path);

export const canvasBox = async (page: Page) => {
  const box = await page
    .locator(".vault-editor canvas.interactive")
    .boundingBox();
  if (!box) {
    throw new Error("canvas not visible");
  }
  return box;
};

/** Excalidraw's hamburger menu hosts export and vault actions. */
export const clickMainMenuItem = async (page: Page, label: string) => {
  await page.getByTestId("main-menu-trigger").click();
  await page.getByRole("menuitem", { name: label }).click();
};

/** Main menu > Export image... opens the package's export dialog. */
export const openExportDialogFromMenu = async (page: Page) => {
  await page.getByTestId("main-menu-trigger").click();
  await page.getByTestId("image-export-button").click();
  await expect(page.locator(".ImageExportModal")).toBeVisible();
};

/** Names of the files handed to the repository's exportFile so far. */
export const exportedNames = (page: Page) =>
  page.evaluate(() =>
    (window as any).__vaultRepo.exported.map((e: any) => e.name as string),
  );

/** A button of the export dialog by its visible text (aria-label differs). */
export const exportDialogButton = (page: Page, label: string) =>
  page.locator(".ImageExportModal button", {
    hasText: new RegExp(`^${label}$`),
  });

/** Closes the top dialog by clicking its backdrop (large dialogs have no X). */
export const closeTopDialog = async (page: Page) => {
  await page.locator(".Modal__background").click({ position: { x: 4, y: 4 } });
  await expect(page.locator(".Modal")).toHaveCount(0);
};
