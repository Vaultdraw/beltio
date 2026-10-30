import { expect, type Locator, type Page } from "@playwright/test";

import { test } from "../fixture";

import { openVault, trackErrors } from "../helpers";

// Hunter D round 2: every official plugin that has a settings page (Auto-export, Table, Markdown
// import), driven like a user: every stepper to both ends with the keyboard and the arrow buttons,
// every segmented choice, every switch, every text box with odd text; then close Settings, open it
// again and check nothing was lost or turned into nonsense.
test.use({ allowedErrors: /Failed to load resource/ });

const PLUGINS = ["Auto-export", "Table", "Markdown import"];

const openPluginSettings = async (page: Page, name: string) => {
  if ((await page.locator(".vault-settings-modal").count()) === 0) {
    await page.keyboard.press("Meta+Comma");
  }
  const d = page.locator(".vault-settings-modal");
  await d.getByRole("tab", { name: "Plugins", exact: true }).click();
  const row = d
    .locator("li, section, div")
    .filter({ hasText: name })
    .filter({
      has: page.getByRole("button", { name: /settings$/i }),
    })
    .last();
  const btn = row.getByRole("button", { name: /settings$/i }).first();
  if ((await btn.innerText()).startsWith("Settings")) {
    await btn.click();
  }
  return { d, row };
};

const num = async (el: Locator) =>
  Number(await el.getAttribute("aria-valuenow"));

test("official plugin settings: steppers stop at their ends, choices and text survive closing Settings", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await openVault(page);
  const before: Record<string, string> = {};
  const after: Record<string, string> = {};
  const state = (d: Locator) =>
    d.evaluate((root) => {
      const out: string[] = [];
      root
        .querySelectorAll("[role=spinbutton]")
        .forEach((e) =>
          out.push(
            `${e.getAttribute("aria-label")}=${e.getAttribute(
              "aria-valuenow",
            )}`,
          ),
        );
      root
        .querySelectorAll("input[type=checkbox]")
        .forEach((e: any) =>
          out.push(`${e.getAttribute("aria-label")}=${e.checked}`),
        );
      root
        .querySelectorAll("input[type=text]")
        .forEach((e: any) =>
          out.push(`${e.getAttribute("aria-label")}="${e.value}"`),
        );
      root
        .querySelectorAll("[role=group] button")
        .forEach((e) =>
          out.push(
            `${e.closest("[role=group]")!.getAttribute("aria-label")}/${
              e.textContent
            }=${
              e.getAttribute("aria-pressed") ?? e.getAttribute("aria-checked")
            }`,
          ),
        );
      return out.filter((l) => !/^Enable /.test(l)).join(" | ");
    });

  for (const plugin of PLUGINS) {
    const { row } = await openPluginSettings(page, plugin);
    const steppers = row.locator("[role=spinbutton]");
    for (let i = 0; i < (await steppers.count()); i++) {
      const s = row.locator("[role=spinbutton]").nth(i);
      const label = await s.getAttribute("aria-label");
      const min = Number(await s.getAttribute("aria-valuemin"));
      const max = Number(await s.getAttribute("aria-valuemax"));
      await s.focus();
      await page.keyboard.press("Home");
      expect(await num(s), `${plugin}/${label} Home`).toBe(min);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("PageDown");
      expect(await num(s), `${plugin}/${label} below min`).toBe(min);
      await expect(
        row.getByRole("button", { name: `Decrease ${label}` }),
      ).toBeDisabled();
      await page.keyboard.press("End");
      expect(await num(s), `${plugin}/${label} End`).toBe(max);
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("PageUp");
      expect(await num(s), `${plugin}/${label} above max`).toBe(max);
      await expect(
        row.getByRole("button", { name: `Increase ${label}` }),
      ).toBeDisabled();
      // an arrow button steps back inside the range
      await row.getByRole("button", { name: `Decrease ${label}` }).click();
      const inside = await num(s);
      expect(inside, `${plugin}/${label} one step down`).toBeLessThan(max);
      expect(inside).toBeGreaterThanOrEqual(min);
    }
    for (const g of await row.locator("[role=group]").all()) {
      const buttons = g.getByRole("button");
      for (let b = 0; b < (await buttons.count()); b++) {
        await buttons.nth(b).click();
        const pressed =
          (await buttons.nth(b).getAttribute("aria-pressed")) ??
          (await buttons.nth(b).getAttribute("aria-checked"));
        expect(pressed, `${plugin} ${await buttons.nth(b).innerText()}`).toBe(
          "true",
        );
      }
    }
    const switches = row.getByRole("switch");
    for (let n = 0; n < (await switches.count()); n++) {
      const sw = switches.nth(n);
      const label = (await sw.getAttribute("aria-label")) ?? "";
      if (/^Enable /.test(label)) {
        continue; // the plugin's own on/off switch
      }
      const was = await sw.isChecked();
      await sw.click();
      await expect(sw, `${plugin}/${label}`).toBeChecked({ checked: !was });
    }
    for (const box of await row.locator("input[type=text]").all()) {
      for (const text of [
        "../up",
        "/abs/path",
        ".hidden",
        "a".repeat(300),
        "😀 émoji, Ünï",
        "  ",
      ]) {
        await box.fill(text);
        await box.blur();
        await page.waitForTimeout(80);
      }
      await box.fill("Keep, Me");
      await box.blur();
    }
    before[plugin] = await state(row);
  }
  // close Settings and open it again: the same values
  await page.keyboard.press("Escape");
  await expect(page.locator(".vault-settings-modal")).toHaveCount(0);
  for (const plugin of PLUGINS) {
    const { row } = await openPluginSettings(page, plugin);
    after[plugin] = await state(row);
    // the row's own settings must match what was left (other plugins' open sections are in the same dialog)
    for (const part of before[plugin].split(" | ")) {
      expect(after[plugin], `${plugin} kept ${part}`).toContain(part);
    }
  }
  expect(errors).toEqual([]);
});

// Parity: Obsidian's and Zed's number settings take typed numbers; ours is a span that only steps.
test.fixme(
  "a number setting in a plugin page takes a typed value (Elements per drawing: 5000)",
  async ({ page }) => {
    await openVault(page);
    const { row } = await openPluginSettings(page, "Markdown import");
    const s = row.getByRole("spinbutton", { name: "Elements per drawing" });
    const was = await num(s);
    await s.focus();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("5000");
    await page.keyboard.press("Enter");
    expect(await num(s)).toBe(5000);
    expect(was).not.toBe(5000);
  },
);
