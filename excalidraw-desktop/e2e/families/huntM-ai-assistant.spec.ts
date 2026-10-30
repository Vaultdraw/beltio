import { type Page } from "@playwright/test";

import { expect, test } from "../fixture";

import { openVault, trackErrors } from "../helpers";
import { live, seedAndOpen } from "../pageHelpers";

// Hunter M (2026-10-30 night): the AI assistant (ac487f18) by eye and by every button, against the
// harness's scripted provider only (`__plugins.backend.net.respond`; nothing leaves the machine).
// Reference: Zed's assistant panel and Obsidian's Copilot / Smart Connections panels: a refused
// send keeps what you typed, copy confirms, a key is never shown again, one Cmd+Z takes back an
// inserted diagram.

const SHOTS = "../.cache/huntM-ai";
const KEY = "sk-ant-huntm-SECRET-1234";

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });

const run = async (page: Page, query: string, title: RegExp) => {
  await page.keyboard.press("Meta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type(query);
  await expect(
    palette(page).getByRole("option").filter({ hasText: title }).first(),
  ).toBeVisible();
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

const anthropic = (parts: string[]) =>
  parts
    .map(
      (t) =>
        `data: ${JSON.stringify({
          type: "content_block_delta",
          delta: { type: "text_delta", text: t },
        })}\n\n`,
    )
    .concat('data: {"type":"message_stop"}\n\n');

/** Vault with a drawing, the assistant switched on in Settings, its panel open on Ask. */
const setup = async (page: Page, size = { width: 1200, height: 800 }) => {
  // Open wide (a narrow window folds the file list the seed helper clicks), then resize.
  await page.setViewportSize({ width: 1200, height: 800 });
  await openVault(page, "?plugins=ai-assistant&enabled=none");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Plan.excalidraw", {
    elements: [text("a", 60, "Login page"), text("b", 130, "Checkout page")],
  });
  await run(page, "open plugin settings", /Plugins: Open plugin settings/);
  const row = page.getByTestId("plugin-ai-assistant");
  await row
    .getByRole("switch", { name: "Enable AI assistant" })
    .click({ force: true });
  await expect(
    row.getByRole("switch", { name: "Enable AI assistant" }),
  ).toBeChecked();
  await page.keyboard.press("Escape");
  await run(page, "AI: Ask about", /AI: Ask about this drawing/);
  await page.setViewportSize(size);
  await expect(page.getByLabel("Ask about this drawing")).toBeVisible();
};

const respond = (page: Page, reply: object) =>
  page.evaluate((r) => {
    (window as any).__plugins.backend.net.respond = () => r;
  }, reply);

const saveKey = async (page: Page) => {
  await page.getByText("Key and provider").click();
  await page.getByLabel("API key").fill(KEY);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText("A key is saved on this computer")).toBeVisible();
};

test.use({ actionTimeout: 8000 });

// toimprove M-15: the panel empties the box on Send before the send is checked, so a refused send
// (no key, empty drawing, Offline mode) loses the question the user typed.
test("AI: a refused Send (no key) keeps the question in the box", async ({
  page,
}) => {
  test.fail(true, "toimprove M-15: the question is cleared before the refusal");
  const errors = trackErrors(page);
  await setup(page);
  const input = page.getByLabel("Ask about this drawing");
  await input.fill("What pages are there?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("No API key is saved");
  await expect(input).toHaveValue("What pages are there?");
  expect(errors).toEqual([]);
});

// A wrong key: plain words, the key never on the page; then Remove key goes back to "no key".
test("AI: a wrong key says so in plain words; Remove key forgets it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await setup(page);
  await saveKey(page);
  await respond(page, {
    status: 401,
    chunks: [
      '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    ],
  });
  const input = page.getByLabel("Ask about this drawing");
  await input.fill("What pages are there?");
  await page.getByRole("button", { name: "Send" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("did not accept the key");
  await expect(page.locator("body")).not.toContainText(KEY);
  await page.getByRole("button", { name: "Remove key" }).click();
  await expect(page.getByText("No key is saved.")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        Object.keys(
          (window as any).__plugins.backend.net.secrets["ai-assistant"] ?? {},
        ).length,
    ),
  ).toBe(0);
  expect(errors).toEqual([]);
});

// toimprove M-16: Copy under an answer writes the clipboard with no notice either way; every other
// copy in the app says "Copied …" or "Could not copy …" (K-2 family, toimprove 207).
test("AI: Copy under an answer says it copied (or could not)", async ({
  page,
}) => {
  test.fail(true, "toimprove M-16: the assistant's Copy is silent");
  const errors = trackErrors(page);
  await setup(page);
  await saveKey(page);
  await respond(page, { chunks: anthropic(["Two pages."]) });
  await page.getByLabel("Ask about this drawing").fill("Pages?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Two pages.")).toBeVisible();
  await page.getByRole("button", { name: "Copy" }).click();
  await expect(page.locator(".vd-toast")).toContainText(
    /copied|could not copy/i,
  );
  expect(errors).toEqual([]);
});

// "Draw it" inserts the model's Mermaid as shapes; one Cmd+Z takes them all back (the panel says so).
test("AI: Draw it, then one Cmd+Z removes the whole diagram", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await setup(page);
  await saveKey(page);
  await page.getByRole("tab", { name: /diagram/i }).click();
  await respond(page, {
    chunks: anthropic([
      "```mermaid\nflowchart LR\n  A[Login] --> B[Checkout]\n```",
    ]),
  });
  const before = (await live(page)).elements.length;
  await page.getByRole("textbox").first().fill("login then checkout");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Draw it" }).click();
  await expect(page.getByText(/Drew \d+ shapes/)).toBeVisible();
  await expect
    .poll(async () => (await live(page)).elements.length)
    .toBeGreaterThan(before);
  await page.locator(".vault-editor canvas.interactive").click({
    position: { x: 5, y: 5 },
  });
  await page.keyboard.press("Meta+z");
  await expect
    .poll(async () => (await live(page)).elements.length)
    .toBe(before);
  expect(errors).toEqual([]);
});

// By eye: the panel with an answer and an error, light and dark, narrow and wide. Screenshots go to
// .cache/huntM-ai for review; the checks are what a screenshot reviewer would look for.
for (const theme of ["light", "dark"] as const) {
  for (const size of [
    { width: 480, height: 760 },
    { width: 1200, height: 800 },
  ]) {
    test(`AI panel by eye: ${theme} ${size.width}px, nothing clipped or off-screen`, async ({
      page,
    }) => {
      const errors = trackErrors(page);
      await page.emulateMedia({ colorScheme: theme });
      await setup(page, size);
      await saveKey(page);
      await respond(page, {
        chunks: anthropic([
          "There are two pages: a login page and a checkout page. ",
          "A_very_long_unbroken_identifier_that_a_model_might_return_0123456789_abcdefghij",
        ]),
      });
      await page.getByLabel("Ask about this drawing").fill("Pages?");
      await page.getByLabel("Show what is sent").check();
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.getByText(/two pages/)).toBeVisible();
      const panel = page.locator(".vd-ai");
      await panel.screenshot({
        path: `${SHOTS}/panel-${theme}-${size.width}.png`,
      });
      await page.screenshot({
        path: `${SHOTS}/window-${theme}-${size.width}.png`,
      });
      const b = (await panel.boundingBox())!;
      expect(b.x, "panel left edge on screen").toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, "panel right edge on screen").toBeLessThanOrEqual(
        size.width + 1,
      );
      const overflow = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(
          ".vd-ai, .vd-ai *",
        )) {
          if (el.scrollWidth > el.clientWidth + 1 && el.tagName !== "PRE") {
            const ox = getComputedStyle(el).overflowX;
            if (ox === "visible" || ox === "hidden") {
              out.push(`${el.tagName}.${el.className}`);
            }
          }
        }
        return out;
      });
      expect(overflow, "clipped content in the panel").toEqual([]);
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(sideways, "page scrolls sideways").toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }
}

// toimprove M-21: the panel's "Show what is sent" checkbox keeps the system colour (green on this
// Mac) in every theme; the app's own checkboxes and the graph plugin's use the theme's primary
// colour (`accent-color: var(--vault-primary)`, settings.css, paper.css, graph.css).
test("AI panel: the checkbox follows the theme colour like the app's own", async ({
  page,
}) => {
  test.fail(true, "toimprove M-21: no accent-color in ai.css");
  const errors = trackErrors(page);
  await setup(page);
  const box = page.getByLabel("Show what is sent");
  const [accent, primary] = await box.evaluate((el) => [
    getComputedStyle(el).accentColor,
    getComputedStyle(document.documentElement)
      .getPropertyValue("--vault-primary")
      .trim(),
  ]);
  expect(primary).not.toBe("");
  expect(accent).not.toBe("auto");
  expect(errors).toEqual([]);
});

// toimprove M-22: tonight's narrow layout (19a948b3) makes the file list an overlay below
// `[layout] narrow_width` so the drawing keeps room ("a 280 px list plus 320 px of drawing",
// layoutSettings.test.ts). A plugin side panel (here the AI assistant) still docks at full width:
// at 480 px the drawing is a ~250 px sliver, its text cut and the toolbar down to two tools.
// Reference: Obsidian's right sidebar becomes a drawer over the content in a narrow window, like
// its left one.
test("AI panel at 480 px leaves the drawing at least 320 px, like the file list does", async ({
  page,
}) => {
  test.fail(
    true,
    "toimprove M-22: plugin panels dock at full width in narrow windows",
  );
  const errors = trackErrors(page);
  await setup(page, { width: 480, height: 760 });
  const canvas = (await page
    .locator(".vault-editor canvas.interactive")
    .boundingBox())!;
  expect(
    canvas.width,
    "drawing width with the panel open",
  ).toBeGreaterThanOrEqual(320);
  expect(errors).toEqual([]);
});
