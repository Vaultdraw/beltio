/**
 * First-run setup, through the visible UI: a full run by clicking, a keyboard-only run, skip,
 * "Run setup again" from the palette, and (SETUP_SHOTS=1) screenshots of every step in light
 * and dark at 1280 and 360 px for the owner.
 */
import { mkdirSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

const SHOTS_DIR = "../personal/feature/onboarding/shots";

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

/** `query` is the harness query string; screenshots pass ?autosave=500, the real install's default. */
const fresh = async (page: Page, query = "") => {
  // The harness reopens its fake vault by itself; a first launch has none to reopen.
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
  await page.goto(`/e2e.html${query}`);
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
  await setup(page).getByRole("radio", { name: "Dark", exact: true }).check();
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
  // Arrows move inside a group (WebKit's Tab skips form controls by default, so focus it directly).
  await setup(page).getByRole("radio", { name: "Follow system" }).focus();
  await expect(
    setup(page).getByRole("radio", { name: "Follow system" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(
    setup(page).getByRole("radio", { name: "Dark", exact: true }),
  ).toBeChecked();
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
  await expect(palette.getByRole("combobox")).toHaveValue(">");
  await page.keyboard.type("Run setup again");
  await expect(
    palette.getByRole("option", { name: /Run setup again/ }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(setup(page)).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(setup(page)).toHaveAttribute("data-step", "basics");
  await expect(
    setup(page).getByRole("switch", { name: /Vim-style keys/ }),
  ).not.toBeChecked();
  await setup(page)
    .getByRole("radio", { name: /Relaxed/ })
    .check();
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
  expect(await stored(page)).toMatchObject({ autosaveDelayMs: 2000 });
});

test("Open an Obsidian vault, then cancel the folder picker: the old vault picker shows, nothing is lost", async ({
  page,
}) => {
  await fresh(page);
  await page.evaluate(() => {
    (window as any).__vaultRepo.chooseVault = async () => null;
  });
  for (let i = 0; i < 5; i++) {
    await nextButton(page).click();
  }
  await expect(setup(page)).toHaveAttribute("data-step", "vault");
  await setup(page)
    .getByRole("radio", { name: /Obsidian/ })
    .check();
  await nextButton(page).click();
  await expect(setup(page)).toHaveAttribute("data-step", "done");
  await nextButton(page).click();
  await expect(setup(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Open vault folder/ }),
  ).toBeVisible();
  expect(await stored(page)).toMatchObject({ onboardingCompleted: true });
});

test("Offline mode, then back to Look: the browse link gives way to a plain sentence; online again, it opens the browser above the setup", async ({
  page,
}) => {
  await fresh(page);
  await page.route("https://raw.githubusercontent.com/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ schemaVersion: 1, themes: [] }),
    }),
  );
  for (let i = 0; i < 3; i++) {
    await nextButton(page).click();
  }
  await setup(page)
    .getByRole("radio", { name: /Offline mode/ })
    .check();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(setup(page)).toHaveAttribute("data-step", "look");
  await expect(
    setup(page).getByRole("button", { name: "Browse community themes" }),
  ).toHaveCount(0);
  await expect(setup(page)).toContainText("once Offline mode is off");
  await nextButton(page).click();
  await nextButton(page).click();
  await setup(page)
    .getByRole("radio", { name: /^Online/ })
    .check();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await setup(page)
    .getByRole("button", { name: "Browse community themes" })
    .click();
  const browser = page.getByTestId("theme-browser-dialog");
  await expect(browser).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(browser).toHaveCount(0);
  await expect(setup(page)).toHaveAttribute("data-step", "look");
});

test("a window resized mid-setup keeps the step and the answers and never scrolls sideways", async ({
  page,
}) => {
  await fresh(page);
  await nextButton(page).click();
  await setup(page).getByRole("radio", { name: "Dark", exact: true }).check();
  for (const [w, h] of [
    [360, 700],
    [1280, 850],
    [360, 700],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await expect(setup(page)).toHaveAttribute("data-step", "look");
    await expect(
      setup(page).getByRole("radio", { name: "Dark", exact: true }),
    ).toBeChecked();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await expect(nextButton(page)).toBeInViewport({ ratio: 0 });
  }
});

test("a new screen starts at the top, not where the button below the last one left the scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 500 });
  await fresh(page);
  await nextButton(page).click();
  await nextButton(page).scrollIntoViewIfNeeded();
  await nextButton(page).click();
  await expect(setup(page)).toHaveAttribute("data-step", "basics");
  expect(
    await setup(page).evaluate((el) => (el as HTMLElement).scrollTop),
  ).toBe(0);
  await expect(setup(page).getByRole("heading")).toBeInViewport();
});

test("the setup keeps its place from step to step: the dots do not jump", async ({
  page,
}) => {
  await fresh(page);
  const dotsY = async () =>
    Math.round(
      await setup(page)
        .locator(".vault-setup__dots")
        .evaluate((el) => el.getBoundingClientRect().top),
    );
  const first = await dotsY();
  for (let i = 0; i < 6; i++) {
    await nextButton(page).click();
    expect(await dotsY()).toBe(first);
  }
});

test("quitting mid-setup and starting again: the answers are kept and the setup runs again from the start", async ({
  page,
}) => {
  await fresh(page);
  await nextButton(page).click();
  await setup(page).getByRole("radio", { name: "Dark", exact: true }).check();
  await nextButton(page).click();
  await setup(page)
    .getByRole("switch", { name: /Vim-style keys/ })
    .check();
  await page.reload();
  await expect(setup(page)).toHaveAttribute("data-step", "welcome");
  await nextButton(page).click();
  await expect(
    setup(page).getByRole("radio", { name: "Dark", exact: true }),
  ).toBeChecked();
  await nextButton(page).click();
  await expect(
    setup(page).getByRole("switch", { name: /Vim-style keys/ }),
  ).toBeChecked();
  expect(await stored(page)).toMatchObject({
    onboardingCompleted: false,
    theme: "dark",
    notesVim: true,
  });
});

test("Done shows a real install's save speed (Quick), not the test harness's 100 ms", async ({
  page,
}) => {
  await fresh(page, "?autosave=500");
  for (let i = 0; i < 6; i++) {
    await nextButton(page).click();
  }
  await expect(page.getByTestId("setup-summary")).toContainText("Quick");
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
      // The harness saves after 100 ms to keep specs short; a real install says "Quick" (500 ms).
      await fresh(page, "?autosave=500");
      for (let i = 0; i < STEPS.length; i++) {
        if (STEPS[i] === "look") {
          await setup(page)
            .getByRole("radio", {
              name: mode === "dark" ? "Dark" : "Light",
              exact: true,
            })
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
