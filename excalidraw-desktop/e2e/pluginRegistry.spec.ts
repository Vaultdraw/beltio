import { createHash } from "node:crypto";

import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

// Settings, Plugins, Browse: no question, a list served by a local fixture (the default
// registry address is intercepted), details with permissions, install, update, uninstall.

const BASE = "/Vaultdraw/plugin-registry/main/";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("Browse community plugins: no question, install, update and uninstall", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const counter = Buffer.from("fixture package: word-count 1.0.0");
  const hello = Buffer.from("fixture package: hello 0.2.0");
  const files: Record<string, string | Buffer> = {
    [`${BASE}index.json`]: JSON.stringify({
      schema: 1,
      plugins: [
        {
          id: "word-count",
          name: "Word count",
          author: "ada",
          description: "Counts the words in a note.",
          version: "1.0.0",
          api: 0,
          permissions: ["vault.read"],
          sha256: sha(counter),
          url: "packages/word-count-1.0.0.zip",
          size: counter.length,
        },
        {
          id: "hello",
          name: "Hello",
          author: "grace",
          description: "Says hello.",
          version: "0.2.0",
          api: 0,
          permissions: [],
          sha256: sha(hello),
          url: "packages/hello-0.2.0.zip",
        },
      ],
    }),
    [`${BASE}packages/word-count-1.0.0.zip`]: counter,
    [`${BASE}packages/hello-0.2.0.zip`]: hello,
  };
  const requested: string[] = [];
  await page.route("https://raw.githubusercontent.com/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    requested.push(path);
    const body = files[path];
    await route.fulfill(
      body === undefined
        ? { status: 404, body: "not found" }
        : {
            status: 200,
            headers: { "access-control-allow-origin": "*" },
            body,
          },
    );
  });

  await openVault(page, "?plugins=hello&enabled=none");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  await page.getByRole("dialog").getByRole("tab", { name: "Plugins" }).click();
  await page.getByRole("button", { name: "Browse community plugins…" }).click();

  const browser = page.getByTestId("plugin-browser-dialog");
  await expect(browser.getByTestId("plugin-browser-offline")).toHaveCount(0);

  const list = browser.getByRole("listbox", { name: "Community plugins" });
  await expect(list.getByRole("option")).toHaveCount(2);
  await expect(list.getByRole("option", { name: /Hello/ })).toContainText(
    "Update",
  );

  await browser.getByLabel("Search plugins").fill("words");
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(browser.getByTestId("plugin-browser-permissions")).toContainText(
    "Read the drawings in your vault",
  );
  await browser.getByRole("button", { name: "Install", exact: true }).click();
  await expect(page.getByText("Installed Word count")).toBeVisible();
  await expect(list.getByRole("option", { name: /Word count/ })).toContainText(
    "Installed",
  );

  await browser.getByLabel("Search plugins").fill("hello");
  await browser.getByRole("button", { name: "Update to 0.2.0" }).click();
  await expect(page.getByText("Updated Hello")).toBeVisible();
  await expect(list.getByRole("option", { name: /Hello/ })).toContainText(
    "Installed",
  );

  await browser.getByLabel("Search plugins").fill("word");
  await browser.getByRole("button", { name: "Uninstall" }).click();
  await page
    .getByRole("dialog", { name: "Uninstall Word count?" })
    .getByRole("button", { name: "Uninstall" })
    .click();
  await expect(page.getByText("Uninstalled Word count")).toBeVisible();

  expect(requested).toEqual([
    `${BASE}index.json`,
    `${BASE}packages/word-count-1.0.0.zip`,
    `${BASE}packages/hello-0.2.0.zip`,
  ]);
  expect(errors).toEqual([]);
});
