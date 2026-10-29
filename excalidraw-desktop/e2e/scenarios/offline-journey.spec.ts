import { expect, type Page } from "@playwright/test";

import {
  canvasBox,
  clickMainMenuItem,
  openVault,
  reloadVault,
  readScene,
} from "../helpers";
import { seedAndOpen } from "../pageHelpers";

import { journey } from "./journey";

// Journey: Offline mode on. Every internet feature says so in plain words, and everything else
// (new drawings, drawing, saving, search, tabs, importing a local Obsidian vault) keeps working.
// The switch survives a reload; the badge in the header turns it off again. Neovim and Noctalia
// are the answer key for "offline is a normal mode, not a broken one". Everything is served by
// local stand-ins, nothing reaches the internet (the page refuses outside requests).

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#f00"/></svg>`;
const PIC = "https://images.example.org/static/chip.png";
const SOURCE = {
  name: "Local Notes",
  files: {
    "Hello.md": "# Hello\n\nA note from the other app.\n",
    ".obsidian/app.json": "{}",
  },
};

const settings = (page: Page) => page.locator(".vault-settings-modal");

const openSettings = async (page: Page, tab: string) => {
  if (!(await settings(page).count())) {
    await page
      .getByLabel("Vault file navigator")
      .getByRole("button", { name: "Settings" })
      .click();
  }
  await settings(page).getByRole("tab", { name: tab, exact: true }).click();
};

journey({
  title: "offline-journey",
  setup: async (page, ctx) => {
    ctx.data.requests = [] as string[];
    // Watch, don't block: interception breaks the page's own blob: pieces in WebKit. Every
    // request to a real internet address is written down; Offline mode must send none.
    page.on("request", (req) => {
      const u = new URL(req.url());
      if (
        /^https?:$/.test(u.protocol) &&
        !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)
      ) {
        ctx.data.requests.push(req.url());
      }
    });
    await openVault(page, "?plugins=markdown-import");
    await page.waitForFunction(() => (window as any).__pluginsReady === true);
    await page.evaluate(
      ([svg, pic, src]) => {
        const be = (window as any).__plugins.backend;
        be.network.images = { [pic]: new TextEncoder().encode(svg) };
        be.folders.sourcePick = src;
      },
      [SVG, PIC, SOURCE] as const,
    );
    await seedAndOpen(page, "Offline.excalidraw", { elements: [] });
  },
  steps: [
    {
      name: "Settings > General: turn Offline mode on; the header badge appears",
      check: { dialogs: 1 },
      run: async (page) => {
        await expect(page.getByTestId("offline-badge")).toHaveCount(0);
        await openSettings(page, "General");
        const sw = settings(page).getByRole("switch", {
          name: "Offline mode",
          exact: true,
        });
        await sw.setChecked(true, { force: true });
        await expect(page.getByTestId("offline-badge")).toBeVisible();
        await expect(page.getByTestId("offline-badge")).toContainText(
          "Offline",
        );
        await expect(
          settings(page).getByRole("switch", {
            name: "Allow downloading themes",
          }),
        ).toBeDisabled();
      },
    },
    {
      name: "Import Obsidian vault works offline: the notes land in a folder",
      run: async (page, ctx) => {
        await page.keyboard.press("Escape");
        await expect(settings(page)).toHaveCount(0);
        await page.evaluate((src) => {
          (window as any).__plugins.backend.folders.sourcePick = src;
        }, SOURCE);
        await clickMainMenuItem(page, "Import Obsidian vault…");
        await expect(
          page
            .locator('.vault-tree-item[data-tree-path="Local Notes"]')
            .first(),
        ).toBeVisible({ timeout: 30_000 });
        const notice = (await page.locator(".vd-toast").allInnerTexts()).join(
          " ",
        );
        if (/\b1 (notes|drawings)\b/.test(notice)) {
          ctx.report(
            `the import notice says "${
              notice.match(/Imported[^\n]*/)?.[0]
            }" (plural for one)`,
          );
        }
      },
    },
    {
      name: "plugin browser, theme browser and Install from link each say Offline mode is on",
      run: async (page) => {
        await openSettings(page, "Plugins");
        await page
          .getByRole("button", { name: "Browse community plugins…" })
          .click();
        const plugins = page.getByTestId("plugin-browser-dialog");
        await expect(
          plugins.getByTestId("plugin-browser-offline"),
        ).toContainText("Offline mode is on");
        await plugins.getByRole("button", { name: "Not now" }).click();
        await expect(plugins).toHaveCount(0);
        await openSettings(page, "Appearance");
        await settings(page)
          .getByRole("button", { name: "Install more themes…" })
          .click();
        const themes = page.getByTestId("theme-browser-dialog");
        await expect(themes.getByTestId("theme-browser-offline")).toContainText(
          "Offline mode is on",
        );
        await themes.getByRole("button", { name: "Not now" }).click();
        await settings(page)
          .getByRole("button", { name: "Install from link…" })
          .click();
        const install = page.getByTestId("theme-install-dialog");
        await expect(
          install.getByTestId("theme-install-offline"),
        ).toContainText("Offline mode is on");
        await install.getByRole("button", { name: "Not now" }).click();
        await page.keyboard.press("Escape");
        await expect(settings(page)).toHaveCount(0);
      },
    },
    {
      name: "a web picture pasted offline becomes a box that says so",
      run: async (page) => {
        const box = await canvasBox(page);
        await page.mouse.click(box.x + 200, box.y + 200);
        await page.evaluate((pic) => {
          const dt = new DataTransfer();
          dt.setData("text/html", `<p>Chip</p><img src="${pic}" alt="Chip">`);
          dt.setData("text/plain", "Chip");
          document.dispatchEvent(
            new ClipboardEvent("paste", {
              clipboardData: dt,
              bubbles: true,
              cancelable: true,
            }),
          );
        }, PIC);
        await expect
          .poll(
            async () =>
              ((await readScene(page, "Offline.excalidraw")).elements as any[])
                .filter((e) => !e.isDeleted && e.type === "text")
                .map((e) => e.text)
                .join(" ")
                .replace(/\s+/g, " "),
            { timeout: 15_000 },
          )
          .toMatch(/Offline mode is on/);
      },
    },
    {
      name: "everything local still works: new drawing, shapes, save, search, a second tab",
      run: async (page) => {
        await page
          .getByLabel("Vault file navigator")
          .getByRole("button", { name: "New drawing" })
          .first()
          .click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Name").fill("Made offline");
        await dialog.getByRole("button", { name: "Create" }).click();
        await expect(dialog).toHaveCount(0);
        const box = await canvasBox(page);
        await page.keyboard.press("r");
        await page.mouse.move(box.x + 300, box.y + 250);
        await page.mouse.down();
        await page.mouse.move(box.x + 420, box.y + 330, { steps: 5 });
        await page.mouse.up();
        await page.keyboard.press("Escape");
        await expect
          .poll(
            async () =>
              (
                (
                  await readScene(page, "Made offline.excalidraw")
                ).elements as any[]
              ).filter((e) => !e.isDeleted).length,
          )
          .toBe(1);
        const search = page.getByPlaceholder("Search drawings and text…");
        await search.fill("Made offline");
        await expect(
          page.locator('.vault-search-row[data-kind="drawing"]').first(),
        ).toContainText("Made offline");
        await search.fill("");
        await page.getByTestId("vault-tab-new").click();
        await expect(page.getByTestId("vault-tab")).toHaveCount(3);
      },
    },
    {
      name: "reload: Offline mode and its badge are still on",
      run: async (page) => {
        await reloadVault(page);
        await expect(page.getByTestId("offline-badge")).toBeVisible();
      },
    },
    {
      name: "click the badge: Offline mode is off, a notice says so and goes away",
      run: async (page, ctx) => {
        await page.getByTestId("offline-badge").click();
        await expect(page.getByTestId("offline-badge")).toHaveCount(0);
        await expect(page.locator(".vd-toast")).toContainText(
          "Offline mode is off",
        );
        await expect(page.locator(".vd-toast")).toHaveCount(0, {
          timeout: 15_000,
        });
        expect(
          ctx.data.requests,
          "nothing reached the network while Offline mode was on",
        ).toEqual([]);
      },
    },
  ],
});
