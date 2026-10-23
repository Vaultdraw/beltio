import { expect, test, type Page } from "@playwright/test";

import { trackErrors } from "./helpers";
import {
  PATH,
  openPanelByShortcut,
  panel,
  rectEl,
  rows,
  runPaletteCommand,
  sceneJson,
  setup,
} from "./historyHelpers";

const PREFS_KEY = "excalidraw-vault-preferences-v1";
const NOTICE_KEY = "vaultdraw.historyGitNotice.v1";
const MB = 1024 * 1024;

const anchor = rectEl("anc", 0, 0, null, 200, 120, 9);
const shape = rectEl("a", 40, 40, null, 80, 60, 1);
const V1 = { json: sceneJson([anchor]) };
const V2 = { json: sceneJson([anchor, shape]) };
const CP = {
  json: sceneJson([anchor, shape]),
  partial: { reason: "checkpoint", name: "Milestone", note: null },
};
const CURRENT = [anchor, shape];

// Newest shared toast (several can be visible at once).
const toast = (page: Page) => page.locator(".vd-toast .vd-toast__text").last();
const dialog = (page: Page) => page.getByRole("dialog");
const settingRow = (page: Page, id: string) =>
  dialog(page).locator(`[data-setting-id="${id}"]`);

const openSettings = async (page: Page) => {
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("tab", { name: "History" }).click();
  await expect(page.getByTestId("history-settings-page")).toBeVisible();
};

const closeSettings = async (page: Page) => {
  await dialog(page).getByRole("button", { name: "Close Settings" }).click();
  await expect(dialog(page)).toHaveCount(0);
};

const prefs = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? "{}"),
    PREFS_KEY,
  );

/** Overrides fields of the fake's `status` (it cannot produce these itself). */
const patchStatus = (page: Page, patch: Record<string, unknown>) =>
  page.evaluate((patch) => {
    const repo = (window as any).__historyRepo;
    const original = repo.status.bind(repo);
    repo.status = async (handle: string) => ({
      ...(await original(handle)),
      ...patch,
    });
  }, patch);

const setGitRepo = (page: Page, value: boolean) =>
  page.evaluate((v) => {
    (window as any).__historyRepo.gitRepo = v;
  }, value);

const callsOf = (page: Page, method: string) =>
  page.evaluate(
    (m) =>
      ((window as any).__historyRepo.calls as string[]).filter((c) => c === m)
        .length,
    method,
  );

const versionCount = (page: Page) =>
  page.evaluate(
    (path) => (window as any).__historyRepo.allVersions(path).length as number,
    PATH,
  );

/** Moves a stepper to `target` with its keyboard (PageUp/Down x5, then arrows). */
const setNumber = async (page: Page, id: string, target: number, step = 1) => {
  const input = settingRow(page, id).getByRole("spinbutton");
  await input.focus();
  const now = Number(await input.getAttribute("aria-valuenow"));
  const steps = Math.round((target - now) / step);
  const key = steps > 0 ? "Up" : "Down";
  const n = Math.abs(steps);
  for (let i = 0; i < Math.floor(n / 5); i++) {
    await input.press(`Page${key}`);
  }
  for (let i = 0; i < n % 5; i++) {
    await input.press(`Arrow${key}`);
  }
  return input;
};

const valueOf = (page: Page, id: string) =>
  settingRow(page, id).getByRole("spinbutton");

test.describe("history settings page", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page, CURRENT, [V1, V2, CP]);
  });

  test("kill switch, interval and retention fields persist in preferences", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openSettings(page);

    const kill = settingRow(page, "history-enabled").getByRole("switch", {
      name: "Enable history",
    });
    await expect(kill).toBeChecked();
    await kill.click();
    await expect(kill).not.toBeChecked();
    await expect
      .poll(async () => (await prefs(page)).historyEnabled)
      .toBe(false);
    await kill.click();
    await expect
      .poll(async () => (await prefs(page)).historyEnabled)
      .toBe(true);

    await setNumber(page, "history-interval", 15);
    await setNumber(page, "history-keep-all", 2);
    await setNumber(page, "history-keep-hourly", 48);
    await setNumber(page, "history-keep-daily", 60);
    await setNumber(page, "history-keep-weekly", 8);
    await expect
      .poll(async () => {
        const p = await prefs(page);
        return [
          p.historyIntervalMinutes,
          p.historyKeepAllHours,
          p.historyKeepHourlyHours,
          p.historyKeepDailyDays,
          p.historyKeepWeeklyWeeks,
        ];
      })
      .toEqual([15, 2, 48, 60, 8]);

    // Out-of-range input is clamped to the field's limits, not stored raw.
    const interval = valueOf(page, "history-interval");
    await interval.focus();
    await interval.press("Home");
    await expect(interval).toHaveAttribute("aria-valuenow", "0");
    await interval.press("ArrowDown");
    await expect(interval).toHaveAttribute("aria-valuenow", "0");
    await expect
      .poll(async () => (await prefs(page)).historyIntervalMinutes)
      .toBe(0);
    await interval.press("End");
    await expect(interval).toHaveAttribute("aria-valuenow", "1440");

    // Persists across a reopen of the dialog.
    await closeSettings(page);
    await openSettings(page);
    await expect(
      settingRow(page, "history-keep-daily").getByRole("spinbutton"),
    ).toHaveAttribute("aria-valuenow", "60");
    expect(errors).toEqual([]);
  });

  test("Time Machine defaults restores the four retention values", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openSettings(page);
    const preset = settingRow(page, "history-retention-preset").getByRole(
      "button",
      { name: "Time Machine defaults" },
    );
    await expect(preset).toBeDisabled();

    await setNumber(page, "history-keep-all", 5);
    await setNumber(page, "history-keep-daily", 7);
    await expect(preset).toBeEnabled();
    await preset.click();

    await expect(
      settingRow(page, "history-keep-all").getByRole("spinbutton"),
    ).toHaveAttribute("aria-valuenow", "1");
    await expect(
      settingRow(page, "history-keep-hourly").getByRole("spinbutton"),
    ).toHaveAttribute("aria-valuenow", "24");
    await expect(
      settingRow(page, "history-keep-daily").getByRole("spinbutton"),
    ).toHaveAttribute("aria-valuenow", "30");
    await expect(
      settingRow(page, "history-keep-weekly").getByRole("spinbutton"),
    ).toHaveAttribute("aria-valuenow", "0");
    await expect(preset).toBeDisabled();
    await expect
      .poll(async () => {
        const p = await prefs(page);
        return [
          p.historyKeepAllHours,
          p.historyKeepHourlyHours,
          p.historyKeepDailyDays,
          p.historyKeepWeeklyWeeks,
        ];
      })
      .toEqual([1, 24, 30, 0]);
    expect(errors).toEqual([]);
  });

  test("size cap shows the usage bar with total, cap and checkpoints; privacy line present", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await patchStatus(page, {
      totalBytes: 150 * MB,
      checkpointBytes: 30 * MB,
    });
    await openSettings(page);

    const usage = page.getByTestId("history-usage");
    await expect(usage).toContainText("150.0 MB of 500.0 MB used");
    await expect(usage).toContainText("of which checkpoints 30.0 MB");
    await expect(usage.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "30",
    );

    // Lowering the cap re-scales the bar; 0 means no limit and no bar.
    await setNumber(page, "history-size-cap", 300, 50);
    await expect(usage).toContainText("150.0 MB of 300.0 MB used");
    await expect(usage.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
    await setNumber(page, "history-size-cap", 0, 50);
    await expect(usage).toContainText("150.0 MB used, no limit");
    await expect(usage.getByRole("progressbar")).toHaveCount(0);
    await expect.poll(async () => (await prefs(page)).historySizeCapMb).toBe(0);

    await expect(settingRow(page, "history-privacy")).toContainText(
      "removed content stays readable in history",
    );
    expect(errors).toEqual([]);
  });

  test("over-cap and gc-blocked notes appear under the size limit", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await patchStatus(page, {
      totalBytes: 600 * MB,
      overCap: "checkpoints",
      gcBlocked: true,
    });
    await openSettings(page);
    const cap = settingRow(page, "history-size-cap");
    await expect(cap).toContainText("only checkpoints are left to remove");
    await expect(cap).toContainText("Thinning is paused until this vault");
    await expect(page.getByTestId("history-usage")).toContainText(
      "600.0 MB of 500.0 MB used",
    );
    await expect(
      page.getByTestId("history-usage").getByRole("progressbar"),
    ).toHaveAttribute("aria-valuenow", "100");
    expect(errors).toEqual([]);
  });

  test("other-devices over-cap note", async ({ page }) => {
    const errors = trackErrors(page);
    await patchStatus(page, { overCap: "other-devices" });
    await openSettings(page);
    await expect(settingRow(page, "history-size-cap")).toContainText(
      "versions from other devices",
    );
    expect(errors).toEqual([]);
  });
});

test.describe("exclude history from git", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page, CURRENT, [V1, V2, CP]);
  });

  test("settings row is hidden outside git vaults; button excludes once then disables", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openSettings(page);
    await expect(settingRow(page, "history-git")).toHaveCount(0);
    await closeSettings(page);

    await setGitRepo(page, true);
    await openSettings(page);
    const button = settingRow(page, "history-git").getByRole("button");
    await expect(button).toHaveText("Exclude history from git");
    await expect(button).toBeEnabled();
    await button.click();
    await expect(button).toHaveText("Excluded");
    await expect(button).toBeDisabled();
    expect(await callsOf(page, "excludeFromGit")).toBe(1);
    expect(errors).toEqual([]);
  });

  test("palette command toasts not-a-git-repo, success, then already-excluded", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const title = "History: Exclude history from git";

    await runPaletteCommand(page, title, "Exclude history from git");
    await expect(toast(page)).toHaveText("This vault is not a git repository");
    expect(await callsOf(page, "excludeFromGit")).toBe(0);

    await setGitRepo(page, true);
    await runPaletteCommand(page, title, "Exclude history from git");
    await expect(toast(page)).toHaveText("History is now excluded from git");
    expect(await callsOf(page, "excludeFromGit")).toBe(1);

    await runPaletteCommand(page, title, "Exclude history from git");
    await expect(toast(page)).toHaveText(
      "History is already excluded from git",
    );
    expect(await callsOf(page, "excludeFromGit")).toBe(1);
    expect(errors).toEqual([]);
  });
});

test.describe("deleting history", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page, CURRENT, [V1, V2, CP]);
  });

  test("settings: Delete all history cancels, then confirms and empties the panel", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openPanelByShortcut(page);
    await expect(rows(page)).toHaveCount(3);
    await page.keyboard.press("ControlOrMeta+Shift+KeyH");
    await expect(panel(page)).toHaveCount(0);

    await openSettings(page);
    const button = settingRow(page, "history-delete-all").getByRole("button", {
      name: "Delete all history…",
    });
    await button.click();
    const confirm = page.getByRole("dialog", {
      name: "Delete all history",
      exact: true,
    });
    await expect(confirm).toContainText("Delete all history of Graphs?");
    await expect(confirm).toContainText("removes every version and checkpoint");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    expect(await versionCount(page)).toBe(3);

    await button.click();
    await confirm.getByRole("button", { name: "Delete all history" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(toast(page)).toHaveText(
      "History of the open drawing deleted.",
    );
    expect(await versionCount(page)).toBe(0);

    await closeSettings(page);
    await openPanelByShortcut(page);
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByTestId("history-last")).toHaveText(
      "No versions yet",
    );
    expect(errors).toEqual([]);
  });

  test("palette: Delete all history of this drawing", async ({ page }) => {
    const errors = trackErrors(page);
    await openPanelByShortcut(page);
    await expect(rows(page)).toHaveCount(3);

    const title = "History: Delete all history of this drawing";
    await runPaletteCommand(page, title, "Delete all history");
    const confirm = page.getByRole("dialog").filter({
      hasText: "removes every version and checkpoint",
    });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(rows(page)).toHaveCount(3);

    await runPaletteCommand(page, title, "Delete all history");
    await confirm.getByRole("button", { name: "Delete all history" }).click();
    await expect(toast(page)).toHaveText("Deleted all history of Graphs");
    await expect(rows(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("checkpoint row: delete button confirms, cancel keeps it", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openPanelByShortcut(page);
    await expect(rows(page)).toHaveCount(3);
    // Only checkpoints carry a delete button.
    await expect(
      panel(page).getByRole("button", { name: /^Delete / }),
    ).toHaveCount(1);
    const del = panel(page).getByRole("button", {
      name: /^Delete .*Milestone/,
    });
    await del.click();
    const confirm = page.getByRole("dialog").filter({
      hasText: "removed on all synced devices",
    });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(rows(page)).toHaveCount(3);

    await del.click();
    await confirm.getByRole("button", { name: "Delete checkpoint" }).click();
    await expect(toast(page)).toHaveText("Checkpoint deleted");
    await expect(rows(page)).toHaveCount(2);
    await expect(panel(page)).not.toContainText("Milestone");
    expect(await callsOf(page, "deleteCheckpoint")).toBe(1);
    expect(errors).toEqual([]);
  });

  test("palette: Delete this checkpoint acts on the selected checkpoint", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openPanelByShortcut(page);
    await expect(rows(page)).toHaveCount(3);
    const title = "History: Delete this checkpoint";

    // An automatic version is selected: the command is not offered.
    await rows(page).last().click();
    await page.keyboard.press("ControlOrMeta+Shift+KeyP");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox").fill(">Delete this checkpoint");
    await expect(
      palette.getByRole("option").filter({ hasText: title }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);

    await rows(page).filter({ hasText: "Milestone" }).click();
    await runPaletteCommand(page, title, "Delete this checkpoint");
    const confirm = page.getByRole("dialog").filter({
      hasText: "removed on all synced devices",
    });
    await confirm.getByRole("button", { name: "Delete checkpoint" }).click();
    await expect(toast(page)).toHaveText("Checkpoint deleted");
    await expect(rows(page)).toHaveCount(2);
    await expect(panel(page)).not.toContainText("Milestone");
    expect(errors).toEqual([]);
  });
});

test.describe("panel notices", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page, CURRENT, [V1, V2]);
  });

  test("git notice: shown in git vaults, Not now is remembered across reload", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const notice = page.getByTestId("history-git-notice");

    // Not a git vault: no notice.
    await openPanelByShortcut(page);
    await expect(rows(page)).toHaveCount(2);
    await expect(notice).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+KeyH");
    await expect(panel(page)).toHaveCount(0);

    await setGitRepo(page, true);
    await openPanelByShortcut(page);
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("This vault is a git repository");
    await notice.getByRole("button", { name: "Not now" }).click();
    await expect(notice).toHaveCount(0);
    const stored = await page.evaluate(
      (k) => JSON.parse(window.localStorage.getItem(k) ?? "{}"),
      NOTICE_KEY,
    );
    expect(Object.values(stored)).toEqual([true]);

    // Closing and reopening the panel keeps it hidden.
    await page.keyboard.press("ControlOrMeta+Shift+KeyH");
    await expect(panel(page)).toHaveCount(0);
    await openPanelByShortcut(page);
    await expect(notice).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("git notice persists dismissal across a page reload", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await setGitRepo(page, true);
    await openPanelByShortcut(page);
    await page
      .getByTestId("history-git-notice")
      .getByRole("button", { name: "Not now" })
      .click();
    // `reload`: setup waits for the reloaded app to boot. A reload followed by
    // a goto cancels the boot chunks and reports "Importing a module script
    // failed" (a navigation artefact that only shows when the server is slow).
    await setup(page, CURRENT, [V1, V2], { reload: true });
    await setGitRepo(page, true);
    await openPanelByShortcut(page);
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByTestId("history-git-notice")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("git notice Exclude button excludes and hides the notice", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await setGitRepo(page, true);
    await openPanelByShortcut(page);
    const notice = page.getByTestId("history-git-notice");
    await notice
      .getByRole("button", { name: "Exclude history from git" })
      .click();
    await expect(toast(page)).toHaveText("History is now excluded from git");
    await expect(notice).toHaveCount(0);
    expect(await callsOf(page, "excludeFromGit")).toBe(1);
    expect(errors).toEqual([]);
  });

  test("over-cap and disk-low warnings show in the panel", async ({ page }) => {
    const errors = trackErrors(page);
    const warnings = panel(page).locator(".vault-history-panel__warnings");
    // Closing is a toggle: wait until the panel is really gone before the next
    // press (and before patching), or two quick presses can land on one state.
    const closePanel = async () => {
      await page.keyboard.press("ControlOrMeta+Shift+KeyH");
      await expect(panel(page)).toHaveCount(0);
    };

    await openPanelByShortcut(page);
    // "No warnings" only means something once the panel has read its status.
    await expect.poll(() => callsOf(page, "status")).toBeGreaterThan(0);
    await expect(rows(page)).toHaveCount(2);
    await expect(warnings).toHaveCount(0);
    await closePanel();

    await patchStatus(page, {
      overCap: "checkpoints",
      lastError: { code: "HISTORY_DISK_LOW", message: "low" },
    });
    await openPanelByShortcut(page);
    await expect(warnings).toContainText("only checkpoints are left to remove");
    await expect(warnings).toContainText("Disk space is low");
    await closePanel();

    await patchStatus(page, { overCap: "other-devices", lastError: null });
    await openPanelByShortcut(page);
    await expect(warnings).toContainText("versions from other devices");
    await expect(warnings).not.toContainText("Disk space is low");
    expect(errors).toEqual([]);
  });
});
