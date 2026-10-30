import { createHash } from "node:crypto";

import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { openVault, trackErrors } from "../helpers";

// Hunter B round 4: the plugin browser with the keyboard (arrows, Enter, Escape), and while the
// list is still loading (a slow network must not trap the user in the dialog).
const BASE = "/Vaultdraw/plugin-registry/main/";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const pkgs = ["alpha", "bravo", "charlie"].map((id) => ({
  id,
  bytes: Buffer.from(`fixture package: ${id}`),
}));
const index = JSON.stringify({
  schema: 1,
  plugins: pkgs.map((p) => ({
    id: p.id,
    name: p.id[0].toUpperCase() + p.id.slice(1),
    author: "ada",
    description: `The ${p.id} plugin.`,
    version: "1.0.0",
    api: 0,
    permissions: [],
    sha256: sha(p.bytes),
    url: `packages/${p.id}-1.0.0.zip`,
  })),
});

const route = async (page: Page, hold: Promise<void>) => {
  await page.route("https://raw.githubusercontent.com/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    await hold;
    const pkg = pkgs.find((p) => path.endsWith(`${p.id}-1.0.0.zip`));
    const body = path === `${BASE}index.json` ? index : pkg?.bytes;
    await r.fulfill(
      body === undefined
        ? { status: 404, body: "no" }
        : {
            status: 200,
            headers: { "access-control-allow-origin": "*" },
            body,
          },
    );
  });
};
const openBrowser = async (page: Page) => {
  await openVault(page, "?plugins=hello&enabled=none");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  await page.getByRole("dialog").getByRole("tab", { name: "Plugins" }).click();
  await page.getByRole("button", { name: "Browse community plugins…" }).click();
  return page.getByTestId("plugin-browser-dialog");
};

test("hunter B: plugin browser: arrows move, Enter installs the current one, Escape closes", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await route(page, Promise.resolve());
  const browser = await openBrowser(page);
  const list = browser.getByRole("listbox", { name: "Community plugins" });
  await expect(list.getByRole("option")).toHaveCount(3);
  await expect(browser.getByLabel("Search plugins")).toBeFocused();
  const cur = () => list.locator('[aria-selected="true"]');
  await expect(cur()).toContainText("Alpha");
  await page.keyboard.press("ArrowDown");
  await expect(cur()).toContainText("Bravo");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(cur()).toContainText("Charlie");
  await page.keyboard.press("ArrowUp");
  await expect(cur()).toContainText("Bravo");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Installed Bravo")).toBeVisible();
  await expect(list.getByRole("option", { name: /Bravo/ })).toContainText(
    "Installed",
  );
  // Enter on an installed plugin installs nothing again
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  await expect(page.getByText("Installed Bravo")).toHaveCount(1);
  // typing narrows, the current one follows the first match
  await page.keyboard.type("char");
  await expect(list.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Installed Charlie")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(browser).toHaveCount(0);
  // Settings is still open under it
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(errors).toEqual([]);
});

test("hunter B: plugin browser can be closed (button and Escape) while the list is loading", async ({
  page,
}) => {
  const errors = trackErrors(page);
  let release!: () => void;
  await route(page, new Promise<void>((r) => (release = r)));
  const browser = await openBrowser(page);
  await expect(browser.getByTestId("plugin-browser-loading")).toBeVisible();
  await page.keyboard.press("Escape");
  const closedByEscape = (await browser.count()) === 0;
  release();
  expect(closedByEscape, "Escape closes while loading").toBe(true);
  expect(errors).toEqual([]);
});
