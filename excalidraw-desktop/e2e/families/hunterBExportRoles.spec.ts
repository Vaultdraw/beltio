import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import {
  exportDialogButton,
  exportedNames,
  openExportDialogFromMenu,
  trackErrors,
} from "../helpers";
import { runCommand } from "../pageHelpers";
import { openSeededVault, sceneJson, treeName } from "../tabsHelpers";

// Hunter B round 4: export to SVG keeps the stored colour of Markdown role text (headings,
// bold, link) in the light and in the dark app theme (only the dialog's own "Dark mode" inverts).
const text = (id: string, role: string, color: string, y: number) => ({
  id,
  type: "text",
  x: 100,
  y,
  width: 200,
  height: 40,
  angle: 0,
  strokeColor: color,
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  boundElements: [],
  link: null,
  locked: false,
  isDeleted: false,
  version: 1,
  versionNonce: 1,
  index: null,
  updated: 1,
  seed: 5,
  text: id,
  fontSize: 32,
  fontFamily: 5,
  textAlign: "left",
  verticalAlign: "top",
  containerId: null,
  originalText: id,
  autoResize: true,
  lineHeight: 1.25,
  customData: { role },
});
const STORED: Record<string, string> = {
  hh: "#1e1e1f",
  bb: "#1e1e25",
  ll: "#1971c3",
  plain: "#e03131",
};
const scene = sceneJson(
  [],
  [
    text("hh", "h1", STORED.hh, 100),
    text("bb", "bold", STORED.bb, 200),
    text("ll", "link", STORED.ll, 300),
    { ...text("plain", "h2", STORED.plain, 400), customData: {} },
  ],
);

const svgFills = (page: Page, name: string) =>
  page.evaluate(async (n) => {
    const files = (window as any).__vaultRepo.exported as Array<{
      name: string;
      bytes: Uint8Array;
    }>;
    const f = [...files].reverse().find((x) => x.name === n)!;
    const s = new TextDecoder().decode(f.bytes);
    const out: Record<string, string> = {};
    for (const m of s.matchAll(/<text[^>]*fill="([^"]+)"[^>]*>([^<]*)</g)) {
      out[m[2].trim()] = m[1].toLowerCase();
    }
    return out;
  }, name);

const exportFills = async (page: Page, darkSwitch?: boolean) => {
  await openExportDialogFromMenu(page);
  if (darkSwitch !== undefined) {
    const sw = page.locator('input[name="exportDarkModeSwitch"]');
    if (darkSwitch) await sw.check();
    else await sw.uncheck();
  }
  await page.evaluate(() => ((window as any).__vaultRepo.exported.length = 0));
  await exportDialogButton(page, "SVG").click();
  await expect.poll(() => exportedNames(page)).toContain("Roles.svg");
  const fills = await svgFills(page, "Roles.svg");
  await page.keyboard.press("Escape");
  await expect(page.locator(".ImageExportModal")).toHaveCount(0);
  return fills;
};

test("hunter B: SVG export keeps the stored colour of role text, in the light and dark app theme and with another theme", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openSeededVault(page, { "Roles.excalidraw": scene });
  await treeName(page, "Roles").click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  const light = await exportFills(page);
  expect(light).toEqual(STORED);
  // Dracula (canvas synced): the export is still the stored colours
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Dracula" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await exportFills(page)).toEqual(STORED);
  // dark app theme: the dialog follows the app (Excalidraw's own rule), and with its
  // "Dark mode" switch off the stored colours come back
  await runCommand(page, "Toggle light/dark mode");
  expect(await exportFills(page, false)).toEqual(STORED);
  expect(errors).toEqual([]);
});
