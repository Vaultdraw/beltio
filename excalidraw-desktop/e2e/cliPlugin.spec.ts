import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

// The newcomer path: `vaultdraw-plugin init` makes a plugin, `dev --once` copies it
// into a config folder's plugins/ (what the app scans), and the app shows its panel.
const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../../sdk/cli/bin/vaultdraw-plugin.mjs");
// Same folder as cliPluginsDir() in fixtures/pluginServer.ts, which serves it.
const CONFIG_DIR = path.resolve(here, "../../.cache/e2e-cli/config");
let work = "";

test.beforeAll(() => {
  rmSync(path.resolve(CONFIG_DIR, ".."), { recursive: true, force: true });
  work = mkdtempSync(path.join(tmpdir(), "vd-cli-e2e-"));
  const run = (...args: string[]) =>
    execFileSync("node", [CLI, ...args], { encoding: "utf8", cwd: work });
  run("init", "cli-timer", "--example", "focus-timer", "--dir", work);
  run("check", path.join(work, "cli-timer"));
  run(
    "dev",
    path.join(work, "cli-timer"),
    "--config-dir",
    CONFIG_DIR,
    "--once",
  );
});

test.afterAll(() => {
  rmSync(work, { recursive: true, force: true });
  rmSync(path.resolve(CONFIG_DIR, ".."), { recursive: true, force: true });
});

test("a plugin made by init and copied by dev shows its panel", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=cli-timer");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);

  await page.getByRole("button", { name: "Focus timer" }).click();
  await expect(page.getByRole("timer")).toHaveText("25:00");
  expect(errors).toEqual([]);
});
