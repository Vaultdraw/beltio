/**
 * First-run setup, through the visible UI: a full run by clicking, a keyboard-only run, skip,
 * "Run setup again" from the palette, and (SETUP_SHOTS=1) screenshots of every step in light
 * and dark at 1280 and 360 px for the owner.
 */
import { mkdirSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

const SHOTS_DIR = "../../personal/feature/onboarding/shots";

const setup = (page: Page) => page.getByTestId("setup");
const nextButton = (page: Page) => setup(page).locator(".vault-setup__primary");
const stored = (page: Page) =>
  page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const raw = localStorage.getItem(localStorage.key(i)!);
      if (raw?.includes("onboardingCompleted")) {
        return JSON.parse(raw) as Record<string, unknown>;
      }
    }
    return {};
  });

const fresh = async (page: Page) => {
  await page.goto("/e2e.html");
  await expect(setup(page)).toBeVisible();
  await expect(setup(page)).toHaveAttribute("data-step", "welcome");
};

test("a full run by clicking: every screen, every choice in the config, the vault opens", async ({
  page,
}) => {
  await fresh(page);
  await expect(
    page.getByRole("heading", {
      name: "Your Excalidraw drawings, in a folder you own",
    }),
  ).toBeVisible();
  await nextButton(page).click();

  await expect(setup(page)).toHaveAttribute("data-step", "look");
  await setup(page).getByRole("radio", { name: "Dark" }).check();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await setup(page).getByRole("radio", { name: /Nord/ }).check();
  await expect(page.getByTestId("setup-preview")).toBeVisible();
  await nextButton(page).click();

  await expect(setup(page)).toHaveAttribute("data-step", "basics");
  await setup(page)
    .getByRole("switch", { name: /Vim-style keys/ })
    .check();
  await setup(page)
    .getByRole("radio", { name: /Relaxed/ })
    .check();
  await nextButton(page).click();

  await expect(setup(page)).toHaveAttribute("data-step", "network");
  await setup(page)
    .getByRole("radio", { name: /Offline mode/ })
    .check();
  await expect(
    setup(page).getByText("Off while Offline mode is on."),
  ).toHaveCount(3);
  await setup(page)
    .getByRole("radio", { name: /^Online/ })
    .check();
  await nextButton(page).click();

  await expect(setup(page)).toHaveAttribute("data-step", "extras");
  await setup(page)
    .getByRole("switch", { name: /Graph view/ })
    .uncheck();
  await expect(page.getByTestId("setup-ai-note")).toContainText(
    "AI assistant: off",
  );
  await nextButton(page).click();

  await expect(setup(page)).toHaveAttribute("data-step", "vault");
  await setup(page)
    .getByRole("radio", { name: /Open a folder/ })
    .check();
  await nextButton(page).click();

  await expect(setup(page)).toHaveAttribute("data-step", "done");
  const summary = page.getByTestId("setup-summary");
  await expect(summary).toContainText("Dark, Nord");
  await expect(summary).toContainText("Vim keys on");
  await expect(summary).toContainText("Relaxed");
  await nextButton(page).click();

  await expect(page.getByLabel("Vault file navigator")).toBeVisible();
  const prefs = await stored(page);
  expect(prefs).toMatchObject({
    onboardingCompleted: true,
    theme: "dark",
    colorTheme: "Nord",
    notesVim: true,
    autosaveDelayMs: 2000,
    networkOffline: false,
    extGraph: false,
    aiEnabled: false,
  });
});

test("keyboard only: Enter next, Esc back, Tab reaches the controls with a visible focus", async ({
  page,
}) => {
  await fresh(page);
  await page.keyboard.press("Enter");
  await expect(setup(page)).toHaveAttribute("data-step", "look");
  await page.keyboard.press("Escape");
  await expect(setup(page)).toHaveAttribute("data-step", "welcome");
  await page.keyboard.press("Enter");
  // Tab lands on the first radio; arrows move inside the group.
  await page.keyboard.press("Tab");
  await expect(setup(page).getByRole("radio", { name: "Light" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(setup(page).getByRole("radio", { name: "Dark" })).toBeChecked();
  for (const id of ["basics", "network", "extras", "vault", "done"]) {
    await page.keyboard.press("Enter");
    await expect(setup(page)).toHaveAttribute("data-step", id);
  }
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Vault file navigator")).toBeVisible();
});

test("Skip setup lands on the old picker with today's defaults, and it does not come back", async ({
  page,
}) => {
  await fresh(page);
  await setup(page).getByRole("button", { name: "Skip setup" }).click();
  await expect(setup(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Open vault folder/ }),
  ).toBeVisible();
  expect(await stored(page)).toMatchObject({
    onboardingCompleted: true,
    notesVim: false,
  });
  await page.getByRole("button", { name: /Open vault folder/ }).click();
  await expect(page.getByLabel("Vault file navigator")).toBeVisible();
});

test("Run setup again from the palette keeps the vault and the current values", async ({
  page,
}) => {
  await fresh(page);
  await setup(page).getByRole("button", { name: "Skip setup" }).click();
  await page.getByRole("button", { name: /Open vault folder/ }).click();
  await expect(page.getByLabel("Vault file navigator")).toBeVisible();

  await page.keyboard.press("Meta+Shift+KeyP");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("Run setup again");
  await page.keyboard.press("Enter");
  await expect(setup(page)).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(setup(page)).toHaveAttribute("data-step", "basics");
  await expect(setup(page).getByRole("radio", { name: /Quick/ })).toBeChecked();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Enter");
  }
  await expect(setup(page)).toHaveAttribute("data-step", "vault");
  await expect(
    setup(page).getByRole("radio", { name: /Keep the vault/ }),
  ).toBeChecked();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(setup(page)).toHaveCount(0);
  await expect(page.getByLabel("Vault file navigator")).toBeVisible();
});

const SHOTS = process.env.SETUP_SHOTS === "1";
const STEPS = [
  "welcome",
  "look",
  "basics",
  "network",
  "extras",
  "vault",
  "done",
];

for (const mode of ["light", "dark"] as const) {
  for (const [width, height, label] of [
    [1280, 850, "1280"],
    [360, 740, "360"],
  ] as const) {
    test(`screenshots: ${mode} at ${label} px`, async ({ page }) => {
      test.skip(!SHOTS, "set SETUP_SHOTS=1 to write the screenshots");
      mkdirSync(SHOTS_DIR, { recursive: true });
      await page.setViewportSize({ width, height });
      await fresh(page);
      for (let i = 0; i < STEPS.length; i++) {
        if (STEPS[i] === "look") {
          await setup(page)
            .getByRole("radio", { name: mode === "dark" ? "Dark" : "Light" })
            .check();
        }
        await expect(setup(page)).toHaveAttribute("data-step", STEPS[i]!);
        await page.waitForTimeout(250);
        await page.screenshot({
          path: `${SHOTS_DIR}/${i + 1}-${STEPS[i]}-${mode}-${label}.png`,
        });
        if (i < STEPS.length - 1) {
          await nextButton(page).click();
        }
      }
    });
  }
}
