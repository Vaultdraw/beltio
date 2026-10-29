import { expect, type Page } from "@playwright/test";

import { openVault, reloadVault } from "../helpers";

import { journey } from "./journey";

// Journey: change each kind of setting (segmented choice, text, slider, switch, drop-down, stepper)
// and see the effect right away, see config.toml's overrides layer change, reload, and see the
// choices kept. Neovim and Noctalia apply a setting live and keep it in a plain file; Obsidian
// applies it live too. The test vault is in memory, so "the file" is the overrides table the
// harness keeps and a reload gets it back from the session store, as a real reload reads the file.

const overrides = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(JSON.stringify((window as any).__e2eOverrides ?? {})),
  );

const typeAccent = async (page: Page) => {
  const field = page.getByRole("dialog").getByLabel("Accent colour hex");
  await field.fill("#d6336c");
  await page.keyboard.press("Enter");
  await expect(field).toHaveValue("#d6336c");
};

const settings = (page: Page) => page.getByRole("dialog");

const openSettings = async (page: Page) => {
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(settings(page)).toBeVisible();
};

const tab = (page: Page, name: string) =>
  settings(page).getByRole("tab", { name, exact: true }).click();

const closeSettings = async (page: Page) => {
  await page.keyboard.press("Escape");
  await expect(settings(page)).toHaveCount(0);
};

const luma = (page: Page) =>
  page.evaluate(() => {
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g) ?? [
      "255",
      "255",
      "255",
    ];
    return (Number(m[0]) + Number(m[1]) + Number(m[2])) / 3 / 255;
  });

/** Changes in the overrides layer since the last call. */
const changes = async (page: Page, ctx: { data: Record<string, any> }) => {
  const now = JSON.stringify(await overrides(page));
  const before = ctx.data.last ?? "{}";
  ctx.data.last = now;
  return { before, now, changed: before !== now };
};

journey({
  title: "settings-journey",
  // TN-4 (accent cleared by the next click) fixed 2026-10-30: a report here fails the journey.
  setup: async (page, ctx) => {
    // The overrides table survives a reload through the session store (the file on disk, for real).
    await page.addInitScript(() => {
      try {
        const saved = sessionStorage.getItem("tn-overrides");
        if (saved) {
          (window as any).__e2eOverrides = JSON.parse(saved);
        }
      } catch {
        /* none */
      }
    });
    await openVault(page, "?config=1");
    ctx.data.last = "{}";
  },
  steps: [
    {
      name: "Appearance > Mode: Dark turns the whole window dark at once",
      check: { dialogs: 1 },
      run: async (page, ctx) => {
        await openSettings(page);
        await tab(page, "Appearance");
        await settings(page)
          .getByRole("group", { name: "Mode" })
          .getByRole("button", { name: "Dark" })
          .click();
        await expect.poll(() => luma(page)).toBeLessThan(0.35);
        expect(
          (await changes(page, ctx)).changed,
          "config.toml layer changed",
        ).toBe(true);
      },
    },
    {
      name: "Appearance > Mode: Light turns it light again",
      check: { dialogs: 1 },
      run: async (page, ctx) => {
        await settings(page)
          .getByRole("group", { name: "Mode" })
          .getByRole("button", { name: "Light" })
          .click();
        await expect.poll(() => luma(page)).toBeGreaterThan(0.6);
        await changes(page, ctx);
      },
    },
    {
      name: "Appearance > Accent: a typed colour is accepted and kept",
      check: { dialogs: 1 },
      run: async (page, ctx) => {
        await typeAccent(page);
        expect(
          JSON.stringify(await overrides(page)).toLowerCase(),
          "the colour is written to the config layer",
        ).toContain("#d6336c");
        await changes(page, ctx);
      },
    },
    {
      name: "Appearance > Mode: changing the mode keeps the chosen accent",
      check: { dialogs: 1 },
      run: async (page, ctx) => {
        const mode = settings(page).getByRole("group", { name: "Mode" });
        await mode.getByRole("button", { name: "Dark" }).click();
        await expect.poll(() => luma(page)).toBeLessThan(0.35);
        await mode.getByRole("button", { name: "Light" }).click();
        await expect.poll(() => luma(page)).toBeGreaterThan(0.6);
        const kept = await settings(page)
          .getByLabel("Accent colour hex")
          .inputValue();
        if (kept !== "#d6336c") {
          ctx.report(
            `the accent colour is lost when the mode changes (field shows "${kept}")`,
          );
          await typeAccent(page);
        }
        await changes(page, ctx);
      },
    },
    {
      name: "Interface > Interface zoom slider: the readout follows each step",
      check: { dialogs: 1 },
      run: async (page, ctx) => {
        // The window itself is scaled by the native webview (Tauri setZoom), which a browser
        // test cannot see; the slider, its readout and the saved value are checked here.
        await tab(page, "Interface");
        const slider = settings(page).getByLabel("Interface zoom");
        const readout = settings(page)
          .locator(".vault-setting-readout")
          .first();
        const before = await readout.innerText();
        await slider.focus();
        for (let i = 0; i < 4; i++) {
          await page.keyboard.press("ArrowRight");
        }
        await expect.poll(() => readout.innerText()).not.toBe(before);
        expect(Number((await readout.innerText()).replace(/\D/g, ""))).toBe(
          Number(before.replace(/\D/g, "")) + 20,
        );
        await changes(page, ctx);
      },
    },
    {
      name: "Interface > Activity bar switch: the bar goes away and comes back",
      check: { dialogs: 1 },
      run: async (page, ctx) => {
        const bar = page.getByRole("toolbar", { name: "Activity bar" });
        const sw = settings(page).getByRole("switch", { name: "Activity bar" });
        const wasOn = await bar.count();
        await sw.click();
        await expect(bar).toHaveCount(wasOn ? 0 : 1);
        await sw.click();
        await expect(bar).toHaveCount(wasOn ? 1 : 0);
        await changes(page, ctx);
      },
    },
    {
      name: "Interface > Navigator sort order: the list reorders",
      check: { dialogs: 1 },
      run: async (page, ctx) => {
        await page.evaluate(() => {
          const repo = (window as any).__vaultRepo;
          const json = JSON.stringify({
            type: "excalidraw",
            version: 2,
            elements: [],
            appState: {},
            files: {},
          });
          for (const name of ["Bravo", "alpha", "Charlie"]) {
            repo.seedDrawing(`${name}.excalidraw`, json);
          }
          repo.emit({ handle: repo.handle, paths: [], rescan: true });
        });
        const order = async () =>
          (await page.locator(".vault-tree-item__name").allTextContents())
            .map((n) => n.trim().replace(/\.excalidraw$/, ""))
            .filter((n) => /^(alpha|Bravo|Charlie)$/.test(n));
        const select = settings(page).getByLabel("Navigator sort order");
        await select.selectOption({ label: "Name (A to Z)" });
        await expect.poll(order).toEqual(["alpha", "Bravo", "Charlie"]);
        await select.selectOption({ label: "Name (Z to A)" });
        await expect.poll(order).toEqual(["Charlie", "Bravo", "alpha"]);
        ctx.data.sort = "Name (Z to A)";
        expect((await changes(page, ctx)).changed).toBe(true);
      },
    },
    {
      name: "Interface > Error notice time stepper: the plus button raises it",
      check: { dialogs: 1 },
      run: async (page, ctx) => {
        const spin = settings(page).getByRole("spinbutton", {
          name: "Error notice time",
        });
        const before = Number(await spin.getAttribute("aria-valuenow"));
        await settings(page)
          .getByRole("button", { name: "Increase Error notice time" })
          .click();
        await expect(spin).toHaveAttribute("aria-valuenow", String(before + 1));
        expect((await changes(page, ctx)).changed).toBe(true);
      },
    },
    {
      name: "close Settings, reload: every choice is still in force",
      run: async (page, ctx) => {
        await closeSettings(page);
        await page.evaluate(() =>
          sessionStorage.setItem(
            "tn-overrides",
            JSON.stringify((window as any).__e2eOverrides ?? {}),
          ),
        );
        await reloadVault(page);
        await openSettings(page);
        await tab(page, "Appearance");
        const accent = await settings(page)
          .getByLabel("Accent colour hex")
          .inputValue();
        if (accent !== "#d6336c") {
          ctx.report(
            `the accent colour is lost after the next setting changes (after reload the field shows "${accent}")`,
          );
        }
        await expect
          .poll(() => luma(page), { message: "mode kept: Light" })
          .toBeGreaterThan(0.6);
        await tab(page, "Interface");
        await expect(
          settings(page)
            .getByLabel("Navigator sort order")
            .locator("option:checked"),
        ).toHaveText("Name (Z to A)");
        await closeSettings(page);
      },
    },
  ],
});
