import { createHash } from "node:crypto";

import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { canvasBox, openVault, readScene, trackErrors } from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Family: Offline mode turns every internet feature off and each one says why in plain words;
// turning it off makes them all work again. Everything is served by local fixtures
// (page.route and the stand-in's picture table), never the internet.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#f00"/></svg>`;
const PIC = "https://images.example.org/static/chip.png";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const THEME = JSON.stringify({
  name: "Daybreak",
  dark: { mPrimary: "#4aa3ff", mSurface: "#101820", mOnSurface: "#e8eef5" },
});

const settingsModal = (page: Page) => page.locator(".vault-settings-modal");

test("Offline mode: plugin browser, theme browser and a web picture say so, then work again", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const requested: string[] = [];
  const files: Record<string, string> = {
    "/Vaultdraw/plugin-registry/main/index.json": JSON.stringify({
      schema: 1,
      plugins: [
        {
          id: "hello",
          name: "Hello",
          author: "grace",
          description: "Says hello.",
          version: "0.2.0",
          api: 0,
          permissions: [],
          sha256: sha("x"),
          url: "packages/hello.zip",
        },
      ],
    }),
    "/Vaultdraw/themes/main/index.json": JSON.stringify({
      schemaVersion: 1,
      themes: [
        {
          name: "Daybreak",
          path: "Daybreak/Daybreak.json",
          author: "E2E",
          description: "A dark theme",
          tags: ["dark"],
          modes: ["dark"],
          swatch: { dark: ["#101820", "#e8eef5", "#4aa3ff"] },
          sha256: sha(THEME),
          previews: [],
        },
      ],
    }),
  };
  await page.route("https://raw.githubusercontent.com/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    requested.push(path);
    const body = files[path];
    await route.fulfill(
      body === undefined
        ? { status: 404, body: "not found" }
        : {
            status: 200,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body,
          },
    );
  });

  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await page.evaluate(
    ([svg, pic]) => {
      (window as any).__plugins.backend.network.images = {
        [pic]: new TextEncoder().encode(svg),
      };
    },
    [SVG, PIC] as const,
  );

  // Online by default: no badge, nothing asked.
  await expect(page.getByTestId("offline-badge")).toHaveCount(0);

  // Settings, General: the Offline mode switch.
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = settingsModal(page);
  await settings.getByRole("tab", { name: "General" }).click();
  const offline = settings.getByRole("switch", {
    name: "Offline mode",
    exact: true,
  });
  await expect(offline).not.toBeChecked();
  await offline.setChecked(true, { force: true });
  await expect(offline).toBeChecked();
  await expect(page.getByTestId("offline-badge")).toBeVisible();
  // The other network switches are greyed out and say why.
  await expect(
    settings.getByRole("switch", { name: "Allow downloading themes" }),
  ).toBeDisabled();

  // The plugin browser says so and sends nothing.
  await settings.getByRole("tab", { name: "Plugins" }).click();
  await page.getByRole("button", { name: "Browse community plugins…" }).click();
  const plugins = page.getByTestId("plugin-browser-dialog");
  await expect(plugins.getByTestId("plugin-browser-offline")).toHaveText(
    "Offline mode is on. Turn it off in Settings to browse plugins.",
  );
  await plugins.getByRole("button", { name: "Not now" }).click();
  await expect(plugins).toHaveCount(0);

  // The theme browser and Install from link too.
  await settings.getByRole("tab", { name: "Appearance" }).click();
  await settings.getByRole("button", { name: "Install more themes…" }).click();
  const themes = page.getByTestId("theme-browser-dialog");
  await expect(themes.getByTestId("theme-browser-offline")).toHaveText(
    "Offline mode is on. Turn it off in Settings to install themes.",
  );
  await themes.getByRole("button", { name: "Not now" }).click();
  await settings.getByRole("button", { name: "Install from link…" }).click();
  const install = page.getByTestId("theme-install-dialog");
  await expect(install.getByTestId("theme-install-offline")).toContainText(
    "Offline mode is on",
  );
  await install.getByRole("button", { name: "Not now" }).click();
  expect(requested).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);

  // Part of a web page with a picture in it becomes a box that says why.
  await seedAndOpen(page, "Paste.excalidraw", { elements: [] });
  const paste = async () => {
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
  };
  const live = async () =>
    ((await readScene(page, "Paste.excalidraw")).elements as any[]).filter(
      (e) => !e.isDeleted,
    );
  await paste();
  await expect
    .poll(async () => (await live()).length, { timeout: 15_000 })
    .toBeGreaterThan(0);
  let els = await live();
  expect(els.filter((e) => e.type === "image")).toHaveLength(0);
  expect(
    els
      .filter((e) => e.type === "text")
      .map((e) => e.text)
      .join(" | ")
      .replace(/\s+/g, " "),
  ).toMatch(/Offline mode is on/);

  // The badge turns Offline mode off again.
  await page.getByTestId("offline-badge").click();
  await expect(page.getByTestId("offline-badge")).toHaveCount(0);

  // Everything works: the picture downloads, the plugin list and the theme list load.
  const before = els.length;
  await paste();
  await expect
    .poll(async () => (await live()).filter((e) => e.type === "image").length, {
      timeout: 15_000,
    })
    .toBe(1);
  els = await live();
  expect(els.length).toBeGreaterThan(before);

  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  await settings.getByRole("tab", { name: "General" }).click();
  await expect(offline).not.toBeChecked();
  await settings.getByRole("tab", { name: "Plugins" }).click();
  await page.getByRole("button", { name: "Browse community plugins…" }).click();
  await expect(
    plugins
      .getByRole("listbox", { name: "Community plugins" })
      .getByRole("option"),
  ).toHaveCount(1);
  await plugins.getByRole("button", { name: "Close" }).first().click();
  await settings.getByRole("tab", { name: "Appearance" }).click();
  await settings.getByRole("button", { name: "Install more themes…" }).click();
  await expect(themes.getByTestId("theme-browser-status")).toContainText(
    "1 of 1 themes",
  );
  expect(requested).toEqual([
    "/Vaultdraw/plugin-registry/main/index.json",
    "/Vaultdraw/themes/main/index.json",
  ]);
  expect(errors).toEqual([]);
});
