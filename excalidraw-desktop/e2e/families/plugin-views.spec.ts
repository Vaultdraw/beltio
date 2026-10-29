import { type Page } from "@playwright/test";

import { expect, test } from "../fixture";
import { openVault, trackErrors } from "../helpers";

// Family (toimprove #103, #105): every official plugin with a view or a panel has its button in
// the activity bar and its command in the palette, in a normal launch AND in plugin safe mode
// (Option held at launch, or "Restart in safe mode"), which turns off only the user's plugins.
// One row per view; see personal/feature/import-upgrade/FAMILY.md.

type Row = { entry: string; label: string; command: RegExp; shows: string };
const VIEWS: Row[] = [
  {
    entry: "activity-bar-graph",
    label: "Graph view",
    command: /Graph: Open graph view/,
    shows: "graph-view",
  },
  {
    entry: "activity-bar-gallery",
    label: "Gallery",
    command: /Gallery: Toggle grid view/,
    shows: "gallery-view",
  },
  {
    entry: "activity-bar-frames.list",
    label: "Frames",
    command: /Toggle Frames panel/,
    shows: "",
  },
  {
    entry: "activity-bar-favourites.list",
    label: "Favourites",
    command: /Toggle Favourites panel/,
    shows: "",
  },
];

const MODES = [
  { name: "normal launch", safeMode: null },
  {
    name: "plugin safe mode",
    safeMode: {
      reason: "modifier",
      scope: "plugins",
      crashedLaunches: 0,
      pluginsAtCrash: [],
    },
  },
];

const inPalette = async (page: Page, command: RegExp) => {
  await page.keyboard.press("Meta+Shift+p");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.type(command.source.split(":").pop()!.trim());
  await expect(
    palette.getByRole("option", { name: command }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
};

for (const mode of MODES) {
  test(`official plugin views have their buttons and commands: ${mode.name}`, async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.addInitScript((safe) => {
      (window as any).__e2ePluginSafeMode = safe;
    }, mode.safeMode);
    await openVault(page);
    const buttonsAndCommands = async () => {
      for (const row of VIEWS) {
        const button = page.getByTestId(row.entry);
        await expect(button, row.entry).toBeVisible();
        await expect(button).toHaveAttribute("aria-label", row.label);
        await inPalette(page, row.command);
      }
    };
    await buttonsAndCommands();
    // The main-area views open from their buttons; the first click starts the plugin host,
    // which is where safe mode used to drop every official plugin.
    for (const row of VIEWS.filter((r) => r.shows)) {
      await page.getByTestId(row.entry).click();
      await expect(page.getByTestId(row.shows)).toBeVisible();
      await page.getByTestId(row.entry).click();
      await expect(page.getByTestId(row.shows)).toHaveCount(0);
    }
    if (mode.safeMode) {
      // Safe mode is on (the host offers "Restart normally"), yet every view stays.
      await inPalette(page, /Restart normally/);
    }
    await buttonsAndCommands();
    expect(errors).toEqual([]);
  });
}
