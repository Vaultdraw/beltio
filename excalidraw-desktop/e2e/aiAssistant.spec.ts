import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";
import { seedAndOpen } from "./pageHelpers";

// The AI assistant, reached the way a user does: it is off, so its commands are not in the palette;
// turn it on in Settings, Plugins (an official plugin needs no consent dialog); ask without a key
// (plain message, nothing sent); save a key; ask a question and watch the answer stream in from a
// scripted provider (no real network); see that the key never travelled with the request; stop an
// answer; Offline mode blocks it in plain words.

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });
const options = (page: Page) => palette(page).getByRole("option");

const run = async (page: Page, query: string, title: RegExp) => {
  await page.keyboard.press("Meta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type(query);
  await expect(options(page).filter({ hasText: title }).first()).toBeVisible();
  await page.keyboard.press("Enter");
};

const base = {
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  isDeleted: false,
  version: 1,
  versionNonce: 1,
  updated: 1,
  locked: false,
};
const text = (id: string, y: number, t: string) => ({
  ...base,
  id,
  type: "text",
  x: 60,
  y,
  width: 150,
  height: 25,
  seed: 1,
  text: t,
  originalText: t,
  fontSize: 20,
  fontFamily: 2,
  textAlign: "left",
  verticalAlign: "top",
  containerId: null,
  autoResize: true,
  lineHeight: 1.25,
  link: null,
  boundElements: null,
});

const KEY = "sk-ant-e2e-SECRET-9876";

test("AI assistant: turn it on, save a key, ask, stream, stop, offline", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=ai-assistant&enabled=none");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Plan.excalidraw", {
    elements: [text("a", 60, "Login page"), text("b", 130, "Checkout page")],
  });

  // Off: nothing of it in the palette.
  await page.keyboard.press("Meta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type("AI: Ask");
  await expect(options(page).filter({ hasText: /^AI:/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // On, through Settings, Plugins.
  await run(page, "open plugin settings", /Plugins: Open plugin settings/);
  await expect(page.getByTestId("plugins-page")).toBeVisible();
  const row = page.getByTestId("plugin-ai-assistant");
  await row
    .getByRole("switch", { name: "Enable AI assistant" })
    .click({ force: true });
  await expect(
    row.getByRole("switch", { name: "Enable AI assistant" }),
  ).toBeChecked();
  await page.keyboard.press("Escape");

  // The scripted provider (Anthropic's stream format) and what it saw.
  await page.evaluate(() => {
    const net = (window as any).__plugins.backend.net;
    net.respond = () => ({
      chunks: [
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Two pages: "}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"login and checkout."}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ],
      chunkDelayMs: 30,
    });
  });

  await run(page, "AI: Ask about", /AI: Ask about this drawing/);
  const input = page.getByLabel("Ask about this drawing");
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();

  // No key yet: a plain message and nothing is sent.
  await input.fill("What pages are there?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("No API key is saved");
  expect(
    await page.evaluate(() => (window as any).__plugins.backend.net.requests.length),
  ).toBe(0);

  // Save the key; it is hidden and not shown again.
  await page.getByText("Key and provider").click();
  const keyBox = page.getByLabel("API key");
  await expect(keyBox).toHaveAttribute("type", "password");
  await keyBox.fill(KEY);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText("A key is saved on this computer")).toBeVisible();
  await expect(keyBox).toHaveValue("");
  await expect(page.locator("body")).not.toContainText(KEY);

  // Ask: the answer streams in, and the request carries the drawing's text but not the key.
  await input.fill("What pages are there?");
  await page.getByLabel("Show what is sent").check();
  await expect(page.getByLabel("What is sent", { exact: true })).toContainText("Login page");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Two pages: login and checkout.")).toBeVisible({
    timeout: 10_000,
  });
  const sent = await page.evaluate(() => {
    const r = (window as any).__plugins.backend.net.requests[0];
    return { ...r, authValue: r.authHeader?.value, authHeader: r.authHeader?.name };
  });
  expect(sent.url).toBe("https://api.anthropic.com/v1/messages");
  expect(sent.authHeader).toBe("x-api-key");
  expect(sent.authValue).toBe(KEY);
  expect(JSON.stringify({ ...sent, authValue: undefined })).not.toContain(KEY);
  expect(sent.body).toContain("Checkout page");

  // Stop a slow answer: what arrived stays, and no error shows.
  await page.evaluate(() => {
    (window as any).__plugins.backend.net.respond = () => ({
      chunks: Array.from({ length: 30 }, (_, i) =>
        `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"w${i} "}}\n\n`,
      ),
      chunkDelayMs: 60,
    });
  });
  await input.fill("Long answer please");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.getByText(/w2 /)).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText(/w29 /)).toHaveCount(0);

  // Offline mode: plain words, nothing reaches another computer.
  await page.evaluate(() => {
    const backend = (window as any).__plugins.backend;
    backend.net.requests.length = 0;
    backend.net.offline = () => true;
  });
  await input.fill("Again");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("Offline mode is on");
  expect(
    await page.evaluate(() => (window as any).__plugins.backend.net.requests.length),
  ).toBe(0);

  expect(errors).toEqual([]);
});
