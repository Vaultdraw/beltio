import { createHash } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { openVault, trackErrors } from "../helpers";

/**
 * Family: clicking any external link or Source/open button opens the right
 * target in the browser (the desktop webview ignores target="_blank").
 * One row per member; add a row when a new link appears.
 */

const THEME = JSON.stringify({
  name: "Linked",
  author: "E2E",
  dark: { mPrimary: "#4aa3ff", mSurface: "#101820", mOnSurface: "#e8eef5" },
});
const SOURCE_URL = "https://example.com/linked-theme-source";

const openSettings = async (page: Page) => {
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
};

const opened = (page: Page) =>
  page.evaluate(() => (window as any).__opened as string[]);

interface Member {
  name: string;
  /** Reaches the control and clicks it, like a user. */
  click: (page: Page) => Promise<void>;
  /** The URL the opener must receive. */
  url: RegExp | string;
}

const aboutButton = (label: string, url: RegExp | string): Member => ({
  name: `About: ${label}`,
  url,
  click: async (page) => {
    const dialog = await openSettings(page);
    await dialog.getByRole("tab", { name: "About" }).click();
    await dialog.getByRole("button", { name: label }).click();
  },
});

const MEMBERS: Member[] = [
  aboutButton("Website", /^https:\/\/vaultdraw\.vercel\.app/),
  aboutButton("Documentation", /^https:\/\/.+/),
  aboutButton("Report a bug", /github\.com\/Vaultdraw\/vaultdraw\/issues\/new/),
  aboutButton("Request a feature", /github\.com\/Vaultdraw\/vaultdraw\/issues/),
  aboutButton("Source code", "https://github.com/Vaultdraw/vaultdraw"),
  {
    name: "Community themes: card Source",
    url: SOURCE_URL,
    click: async (page) => {
      const dialog = await openSettings(page);
      await dialog
        .getByRole("button", { name: "Install more themes..." })
        .click();
      const browser = page.getByTestId("theme-browser-dialog");
      await browser.getByRole("button", { name: "Allow" }).click();
      await browser
        .getByTestId("theme-card-Linked")
        .getByRole("link", { name: "Source" })
        .click();
    },
  },
];

test("every external link opens its target in the browser", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const index = JSON.stringify({
    schemaVersion: 1,
    themes: [
      {
        name: "Linked",
        path: "Linked/Linked.json",
        author: "E2E",
        description: "Has a source link",
        tags: ["dark"],
        modes: ["dark"],
        swatch: { dark: ["#101820", "#e8eef5", "#4aa3ff"] },
        sha256: createHash("sha256").update(THEME).digest("hex"),
        previews: [],
        homepage: SOURCE_URL,
      },
    ],
  });
  await page.route("https://raw.githubusercontent.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: index,
    }),
  );
  // Browser preview opens links with window.open: capture it, no network.
  await page.addInitScript(() => {
    (window as any).__opened = [];
    window.open = (url) => {
      (window as any).__opened.push(String(url));
      return null;
    };
  });
  await openVault(page);

  for (const member of MEMBERS) {
    const before = (await opened(page)).length;
    await member.click(page);
    await expect
      .poll(async () => (await opened(page)).slice(before)[0] ?? "", {
        message: member.name,
      })
      .toMatch(
        typeof member.url === "string"
          ? new RegExp(`^${member.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
          : member.url,
      );
    // Back to a clean screen for the next member.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
