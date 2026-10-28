import { expect, test, type Locator, type Page } from "@playwright/test";

import { openDrawing, openVault } from "./helpers";

// UI redesign visual gallery (not assertions). Skipped unless REDESIGN_SHOTS
// is set to an absolute output directory:
//   REDESIGN_SHOTS=/abs/dir npx playwright test e2e/redesignGallery.spec.ts --project=webkit
const OUT = process.env.REDESIGN_SHOTS;

const THEMES = [
  { slug: "cendre-dark", colourTheme: "Cendre", mode: "Dark" },
  { slug: "default-light", colourTheme: "Default", mode: "Light" },
] as const;

const SETTINGS_PAGES = [
  "General",
  "Appearance",
  "Interface",
  "Drawing",
  "Tools",
  "Files",
  "Hotkeys",
] as const;

const openSettings = async (page: Page) => {
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
};

const closeOverlays = async (page: Page) => {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(80);
  }
};

const row = (page: Page, name: string) =>
  page.locator(".vault-tree-item", { hasText: name }).first();

for (const theme of THEMES) {
  test(`redesign gallery ${theme.slug}`, async ({ page, browserName }) => {
    test.skip(!OUT, "set REDESIGN_SHOTS to an output directory");
    test.skip(browserName !== "webkit", "webkit only");
    test.setTimeout(300_000);

    const skipped: string[] = [];
    const shot = (n: string, surface: string) =>
      page.screenshot({ path: `${OUT}/${theme.slug}-${n}-${surface}.png` });
    // Runs one surface; a failure is noted and the overlays are cleared.
    const surface = async (
      n: string,
      name: string,
      fn: () => Promise<void>,
    ) => {
      try {
        await fn();
        await shot(n, name);
      } catch (e) {
        const msg = `${theme.slug} ${n}-${name} skipped: ${
          String(e).split("\n")[0]
        }`;
        skipped.push(msg);
      }
      await closeOverlays(page);
    };

    await openVault(page);

    // Theme + mode through the app's own Settings > Appearance controls.
    const dialog = await openSettings(page);
    await dialog.getByRole("tab", { name: "Appearance" }).click();
    await dialog
      .getByRole("radio", { name: theme.colourTheme, exact: true })
      .click();
    await dialog
      .locator(".vault-segmented-btn", { hasText: theme.mode })
      .first()
      .click();
    await closeOverlays(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await surface("01", "vault-home", async () => {
      await page.waitForTimeout(200);
    });

    await page
      .locator(".vault-tree-item__name", { hasText: "DSA" })
      .first()
      .click();
    await openDrawing(page, "Graphs");
    await surface("02", "editor", async () => {});

    await surface("03", "navigator-hover", async () => {
      await row(page, "Graphs").hover();
      await page.waitForTimeout(150);
    });

    await surface("04", "main-menu", async () => {
      await page.getByTestId("main-menu-trigger").click();
      await expect(
        page.getByRole("menuitem", { name: "Vault settings" }),
      ).toBeVisible();
      await page.waitForTimeout(200);
    });

    const palette = page.getByRole("dialog", { name: "Command palette" });
    await surface("05", "palette-files", async () => {
      await page.keyboard.press("Meta+KeyP");
      await expect(palette).toBeVisible();
      await palette.getByRole("combobox").fill("gra");
      await page.waitForTimeout(250);
    });
    await surface("06", "palette-commands", async () => {
      await page.keyboard.press("Meta+Shift+KeyP");
      await expect(palette).toBeVisible();
      await palette.getByRole("combobox").fill(">theme");
      await page.waitForTimeout(250);
    });

    await surface("14", "palette-family", async () => {
      await page.keyboard.press("Meta+Shift+KeyP");
      await expect(palette).toBeVisible();
      await palette.getByRole("combobox").fill(">theme");
      await page.waitForTimeout(150);
      await page.keyboard.press("Tab");
      await expect(palette.getByRole("combobox")).toHaveValue(/^>Theme: /);
      await page.waitForTimeout(250);
    });

    // 07-14 settings pages (15 = hotkeys recording).
    await openSettings(page);
    const settings = page.getByRole("dialog");
    let n = 7;
    for (const name of SETTINGS_PAGES) {
      const num = String(n++).padStart(2, "0");
      await surface(num, `settings-${name.toLowerCase()}`, async () => {
        await settings.getByRole("tab", { name }).click();
        await page.waitForTimeout(300);
      });
      // surface() closes overlays; reopen for the next page.
      if (name !== SETTINGS_PAGES[SETTINGS_PAGES.length - 1]) {
        await openSettings(page);
      }
    }
    await openSettings(page);
    await surface("15", "hotkeys-recording", async () => {
      await settings.getByRole("tab", { name: "Hotkeys" }).click();
      const add = settings.getByRole("button", { name: /^Add hotkey for/ });
      await add.first().click();
      await expect(
        settings.getByRole("button", { name: "Cancel recording" }),
      ).toBeVisible();
      await page.waitForTimeout(200);
    });

    const openMenuFor = async (name: string, item: string) => {
      await row(page, name).click({ button: "right" });
      await page.getByRole("menuitem", { name: item }).click();
    };
    await surface("16", "confirm-delete", async () => {
      await openMenuFor("Graphs", "Move to Trash");
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(250);
    });
    await surface("17", "move-dialog", async () => {
      await openMenuFor("Graphs", "Move to…");
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(250);
    });
    await surface("17b", "move-typeahead", async () => {
      await openMenuFor("Graphs", "Move to…");
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.type("dyn");
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(250);
    });
    await surface("18", "rename-dialog", async () => {
      await openMenuFor("Graphs", "Rename…");
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(250);
    });

    await surface("19", "library-sidebar", async () => {
      await page.locator(".default-sidebar-trigger").first().click();
      await expect(page.getByTestId("library-section-personal")).toBeVisible();
      await page.waitForTimeout(250);
    });
    // Close the sidebar if Escape did not.
    if (await page.getByTestId("library-section-personal").isVisible()) {
      await page.locator(".default-sidebar-trigger").first().click();
    }

    await surface("20", "export-dialog", async () => {
      await page.getByTestId("main-menu-trigger").click();
      await page.getByTestId("image-export-button").click();
      const modal: Locator = page.locator(".ImageExportModal");
      await expect(modal).toBeVisible();
      await page.waitForTimeout(300);
    });

    await surface("22", "create-dialog", async () => {
      await page.getByRole("button", { name: "New Drawing" }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.type("Sketch");
      await page.waitForTimeout(250);
    });
    await surface("23", "toast-undo", async () => {
      await page.evaluate(() => {
        (window as any).__vaultToasts.push({
          message: "Moved Graphs to Dynamic Programming",
          action: { label: "Undo", run() {} },
        });
        (window as any).__vaultToasts.push({
          message: "Updated 2 links in 1 drawing",
        });
      });
      await expect(page.locator(".vd-toast")).toHaveCount(2);
      await page.waitForTimeout(250);
    });
    await page.evaluate(() => (window as any).__vaultToasts.clear());
    await surface("24", "banner", async () => {
      await page.evaluate(() => {
        (window as any).__vaultRepo.trash = async () => {
          throw new Error("disk is full");
        };
      });
      await openMenuFor("Graphs", "Move to Trash");
      await page.getByRole("button", { name: "Move to Trash" }).click();
      await expect(page.locator(".vd-toast--error")).toBeVisible();
      await page.waitForTimeout(250);
    });

    // Conflict + recovery: edit, then change the file on disk underneath.
    await surface("25", "conflict-dialog", async () => {
      await openDrawing(page, "Graphs");
      const box = await page
        .locator(".vault-editor canvas.interactive")
        .boundingBox();
      await page
        .locator(".vault-editor [data-testid='toolbar-rectangle']")
        .click();
      const x0 = box!.x + box!.width * 0.25;
      const y0 = box!.y + box!.height * 0.3;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x0 + 140, y0 + 90, { steps: 8 });
      await page.mouse.up();
      await page.evaluate(async () => {
        const repo = (window as any).__vaultRepo;
        const p = "DSA/Graphs.excalidraw";
        const disk = await repo.readDrawing(repo.handle, p);
        const scene = JSON.parse(disk.json);
        scene.elements.push({
          ...scene.elements[0],
          id: "ext",
          x: 900,
          y: 500,
        });
        repo.externalWrite(p, JSON.stringify(scene));
      });
      await page.locator(".vault-badge--conflict").click({ timeout: 8000 });
      await expect(
        page.getByRole("dialog", { name: /Conflict/i }),
      ).toBeVisible();
      await page.waitForTimeout(250);
    });
    await surface("26", "recovery-dialog", async () => {
      await page.evaluate(() => {
        const repo = (window as any).__vaultRepo;
        repo.seedRecovery("DSA/Graphs.excalidraw", "{}");
        repo.seedRecovery("Untitled.excalidraw", "{}");
        repo.emit({ handle: repo.handle, paths: [], rescan: true });
      });
      await page.locator(".vault-badge--recovery").click({ timeout: 8000 });
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(250);
    });

    // 21 onboarding: no vault (a fresh harness page starts at onboarding).
    await surface("21", "onboarding", async () => {
      // Patch the harness repo as soon as it is assigned, so no vault reopens.
      await page.addInitScript(() => {
        let repo: any;
        Object.defineProperty(window, "__vaultRepo", {
          configurable: true,
          get: () => repo,
          set: (v) => {
            repo = v;
            v.reopenVault = async () => null;
          },
        });
      });
      await page.goto("/e2e.html");
      await expect(
        page.getByRole("button", { name: /Open Vault Folder/ }),
      ).toBeVisible();
      await page.waitForTimeout(300);
    });

    skipped.push("");
    // eslint-disable-next-line no-console
    console.log(skipped.join("\n"));
  });
}
