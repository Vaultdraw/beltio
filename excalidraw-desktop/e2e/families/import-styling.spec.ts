import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import {
  clickMainMenuItem,
  openVault,
  readScene,
  screenshot,
  SHOTS,
  trackErrors,
} from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Family: imported notes are styled by the theme, like Obsidian (toimprove #111). A note goes
// through "Import Obsidian vault…": each heading stores its role (h1, h2, h3) and the role
// colour the canvas draws in the active theme's Markdown colour; the theme's `--vault-md-*`
// tokens differ between light and dark, so switching restyles the note; headings step down in
// size like Obsidian's. Colour mapping per theme is unit-tested (src/tests/markdownTheme.test.ts).

const MARK = "plugins.markdown-import";
const ROLE_COLORS: Record<string, string> = {
  h1: "#1e1e1f",
  h2: "#1e1e20",
  h3: "#1e1e21",
};

const NOTE = [
  "# This folder is about understanding of Virtual Machines",
  "Notes from the Q&A session, x86 and Linux terms only.",
  "## Why VMs need special CPU help",
  "A kernel assumes it is the only program in ring 0.",
  "### One disk write, step by step",
  "Host kernel writes it to the real SSD.",
  "**This paragraph is bold from start to end.**",
  "Only **two words** here are bold.",
].join("\n\n");

const setMode = async (page: Page, mode: "Light" | "Dark") => {
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
  await dialog
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: mode })
    .click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
};

const token = (page: Page, name: string) =>
  page.evaluate(
    (n) =>
      getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );

const row = (page: Page, path: string) =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );

test("an imported note's headings follow the theme in light and dark", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  await page.evaluate((note) => {
    (window as any).__plugins.backend.folders.sourcePick = {
      name: "Learning",
      files: { "Kubernetes/VMs.md": note },
    };
  }, NOTE);
  await clickMainMenuItem(page, "Import Obsidian vault…");
  await expect(row(page, "Learning")).toBeVisible({ timeout: 30_000 });
  await row(page, "Learning/Kubernetes")
    .locator(".vault-tree-item__toggle")
    .click();
  await row(page, "Learning/Kubernetes/VMs.excalidraw").click();

  const scene = await readScene(page, "Learning/Kubernetes/VMs.excalidraw");
  const heading = (level: number) =>
    scene.elements.find(
      (e: any) => e.type === "text" && e.customData?.[MARK]?.heading === level,
    );
  for (const level of [1, 2, 3]) {
    const h = heading(level);
    expect(h.customData[MARK].role).toBe(`h${level}`);
    expect(h.strokeColor).toBe(ROLE_COLORS[`h${level}`]);
  }
  // roles are stored where typed Markdown stores them, and headings are bold
  const body = scene.elements.find(
    (e: any) => e.type === "text" && e.text.startsWith("A kernel"),
  );
  for (const level of [1, 2, 3]) {
    const h = heading(level);
    expect(h.customData.role).toBe(`h${level}`);
    expect(h.fontFamily).toBe(body.fontFamily + 100);
  }
  expect(body.customData?.role).toBeUndefined();
  // a paragraph that is all bold uses the bold font; bold words inside a sentence do not
  const textOf = (start: string) =>
    scene.elements.find(
      (e: any) => e.type === "text" && e.text.startsWith(start),
    );
  expect(textOf("This paragraph is bold").fontFamily).toBe(
    body.fontFamily + 100,
  );
  expect(textOf("Only two words here").fontFamily).toBe(body.fontFamily);
  expect(heading(1).fontSize).toBeGreaterThan(heading(2).fontSize);
  expect(heading(2).fontSize).toBeGreaterThan(heading(3).fontSize);
  // The page follows the theme, so the roles draw in the theme's colours.
  expect(scene.appState.pageSetup.paperTheme).toBe("match");

  const seen: Record<string, string> = {};
  for (const mode of ["Light", "Dark"] as const) {
    await setMode(page, mode);
    seen[mode] = await token(page, "--vault-md-h1");
    expect(seen[mode]).toMatch(/^#[0-9a-f]{6}$/);
    await screenshot(page, {
      path: `${SHOTS}/${
        info.project.name
      }-import-styling-${mode.toLowerCase()}.png`,
    });
  }
  expect(seen.Light).not.toBe(seen.Dark);
  expect(errors).toEqual([]);
});
