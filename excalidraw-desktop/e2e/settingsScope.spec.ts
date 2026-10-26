import { expect, test, type Page } from "@playwright/test";

import { runPaletteCommand } from "./historyHelpers";
import { openVault, trackErrors } from "./helpers";

// Settings scope: one Global | This vault switch for every per-vault setting
// (personal/feature/settings-scope/PLAN.md). Everything else (read-only vault,
// no vault, session memory, Tools badge) is covered by unit tests.

const dialog = (page: Page) => page.getByRole("dialog");
const row = (page: Page, id: string) =>
  dialog(page).locator(`[data-setting-id="${id}"]`);
const radio = (page: Page, name: "Global" | "This vault") =>
  dialog(page)
    .getByRole("radiogroup", { name: "Settings scope" })
    .getByRole("radio", { name });
const tab = (page: Page, name: string) =>
  dialog(page).getByRole("tab", { name, exact: true });
const spin = (page: Page, id: string) => row(page, id).getByRole("spinbutton");
const resetBtn = (page: Page, id: string) =>
  row(page, id).getByRole("button", { name: /^Reset .* to global$/ });

const setScope = async (page: Page, name: "Global" | "This vault") => {
  await radio(page, name).click();
  await expect(radio(page, name)).toBeChecked();
};

test.beforeEach(async ({ page }) => {
  await openVault(page);
});

// The one visible-UI test: every step is a click, every check is on screen.
test("settings scope: inherit, override, reset, all by clicking", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(dialog(page)).toBeVisible();
  await tab(page, "History").click();
  await expect(page.getByTestId("history-settings-page")).toBeVisible();

  await setScope(page, "This vault");
  const interval = row(page, "history-interval");
  await expect(interval).toContainText("Inherited from global");
  await expect(spin(page, "history-interval")).toHaveAttribute(
    "aria-valuenow",
    "5",
  );
  await expect(resetBtn(page, "history-interval")).toHaveCount(0);

  // Override with the visible stepper button.
  await interval.getByRole("button", { name: /^Increase / }).click();
  await expect(spin(page, "history-interval")).toHaveAttribute(
    "aria-valuenow",
    "6",
  );
  await expect(interval).toContainText("Overridden");
  await expect(resetBtn(page, "history-interval")).toBeVisible();

  // Global keeps its value and says the vault overrides it.
  await setScope(page, "Global");
  await expect(spin(page, "history-interval")).toHaveAttribute(
    "aria-valuenow",
    "5",
  );
  await expect(interval).toContainText("Overridden in this vault");

  // A global change to a non-overridden row shows up inherited in the vault.
  const keepAll = row(page, "history-keep-all");
  const before = Number(
    await spin(page, "history-keep-all").getAttribute("aria-valuenow"),
  );
  await keepAll.getByRole("button", { name: /^Increase / }).click();
  await expect(spin(page, "history-keep-all")).toHaveAttribute(
    "aria-valuenow",
    String(before + 1),
  );
  await setScope(page, "This vault");
  await expect(keepAll).toContainText("Inherited from global");
  await expect(spin(page, "history-keep-all")).toHaveAttribute(
    "aria-valuenow",
    String(before + 1),
  );

  // Reset to global brings the interval back to inherited with the global value.
  await resetBtn(page, "history-interval").click();
  await expect(interval).toContainText("Inherited from global");
  await expect(spin(page, "history-interval")).toHaveAttribute(
    "aria-valuenow",
    "5",
  );

  // No per-row "This vault" switch in either scope.
  await expect(
    dialog(page).getByRole("switch", { name: /This vault/ }),
  ).toHaveCount(0);
  await setScope(page, "Global");
  await expect(
    dialog(page).getByRole("switch", { name: /This vault/ }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("palette opens Settings in either scope; vault scope is per-vault pages only", async ({
  page,
}) => {
  await runPaletteCommand(page, "Settings: Edit this vault's settings");
  await expect(dialog(page)).toBeVisible();
  await expect(radio(page, "This vault")).toBeChecked();
  await expect(tab(page, "History")).toBeVisible();
  for (const name of ["Hotkeys", "Links", "Drawing"]) {
    await expect(tab(page, name)).toHaveCount(0);
  }
  await tab(page, "Appearance").click();
  await expect(row(page, "paper")).toBeVisible();
  await expect(row(page, "colour-theme")).toBeVisible(); // per-vault theme (68be4277)
  await tab(page, "Tools").click();
  const tools = dialog(page).getByRole("tablist", { name: "Tools" });
  await expect(tools.getByRole("tab", { name: "Pen" })).toHaveCount(0);
  await expect(tools.getByRole("tab", { name: "Laser" })).toHaveCount(0);

  await radio(page, "This vault").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(radio(page, "Global")).toBeChecked();
  await expect(tab(page, "Hotkeys")).toBeVisible();

  await dialog(page).getByRole("button", { name: "Close Settings" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await runPaletteCommand(page, "Settings: Edit global settings");
  await expect(radio(page, "Global")).toBeChecked();
});

// Settings > Tools explains its dots and the greyed-out vault scope
// (toimprove #42). Visible UI only; the vault is read-only.
test("settings tools: legend, dot tooltip and the reason This vault is disabled", async ({
  page,
}) => {
  await openVault(page, "?readonly=1");
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  await tab(page, "Tools").click();
  await expect(page.getByTestId("tools-legend")).toHaveText(
    "Customised defaults. Options you leave unset follow Excalidraw's last-used style.",
  );
  await expect(radio(page, "This vault")).toHaveAttribute(
    "title",
    "This vault is read-only, so vault settings can't be saved",
  );
  await expect(radio(page, "This vault")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  // The reason is on screen, not only in a tooltip.
  await expect(
    dialog(page).getByText(
      "This vault is read-only, so vault settings can't be saved",
    ),
  ).toBeVisible();
  // Customise Arrow through the UI: its tab gets a dot that says what it means.
  const tools = dialog(page).getByRole("tablist", { name: "Tools" });
  await tools.getByRole("tab", { name: "Arrow" }).click();
  await dialog(page)
    .getByTestId("tool-default-arrow-stroke_style")
    .selectOption("dotted");
  await expect(tools.getByRole("tab", { name: "Arrow" })).toHaveAttribute(
    "title",
    "Arrow: this tool has customised defaults",
  );
});
