import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { openVault, trackErrors } from "../helpers";

// Hunter D round 2: switch theme and mode WHILE Settings is open; every settings page must stay
// readable (text against its own background) for every built-in theme, light and dark.
test.use({ allowedErrors: /Failed to load resource/ });

/** Text elements of `root` whose colour is too close to the surface behind them. */
const lowContrast = (page: Page, minRatio: number) =>
  page.evaluate((min) => {
    const root = document.querySelector(".vault-settings-modal")!;
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) {
        return null;
      }
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lum = ({ r, g, b }: any) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const over = (top: any, bottom: any) => ({
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
      a: 1,
    });
    const backdrop = (el: Element) => {
      const stack: any[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c.a > 0) {
          stack.push(c);
          if (c.a >= 1) {
            break;
          }
        }
      }
      let acc: any = { r: 255, g: 255, b: 255, a: 1 };
      for (const c of stack.reverse()) {
        acc = over(c, acc);
      }
      return acc;
    };
    const bad: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.nodeValue ?? "").trim();
      const el = n.parentElement;
      if (!text || !el) {
        continue;
      }
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (
        cs.visibility === "hidden" ||
        cs.display === "none" ||
        r.width < 2 ||
        r.height < 2 ||
        el.closest("[disabled],[aria-disabled=true]") ||
        Number(cs.opacity) < 0.3
      ) {
        continue;
      }
      const fg = parse(cs.color);
      if (!fg) {
        continue;
      }
      const bg = backdrop(el);
      const fgc = over(fg, bg);
      const a = lum(fgc);
      const b = lum(bg);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < min) {
        bad.push(`${text.slice(0, 40)} ${ratio.toFixed(2)}`);
      }
    }
    return bad;
  }, minRatio);

test("Settings stays readable when the theme and mode change while it is open", async ({
  page,
}) => {
  test.setTimeout(420_000);
  const errors = trackErrors(page);
  await openVault(page);
  await page.keyboard.press("Meta+Comma");
  const d = page.locator(".vault-settings-modal");
  await expect(d).toBeVisible();
  await d.getByRole("tab", { name: "Appearance", exact: true }).click();
  const names = await d
    .getByRole("radio")
    .evaluateAll((els) =>
      els.map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim()),
    );
  const tabs = await d
    .getByRole("tab")
    .evaluateAll((els) => els.map((e) => (e.textContent || "").trim()));
  const report: string[] = [];
  for (const [ti, t] of names.entries()) {
    if (ti < names.indexOf("Default")) {
      continue;
    }
    for (const mode of ["Light", "Dark"]) {
      await d.getByRole("tab", { name: "Appearance", exact: true }).click();
      await d.getByRole("radio").nth(ti).click();
      await d
        .getByRole("group", { name: "Mode" })
        .getByRole("button", { name: mode, exact: true })
        .click();
      await expect(d).toBeVisible(); // still open: no switch closed it
      for (const tab of tabs) {
        await d.getByRole("tab", { name: tab, exact: true }).click();
        const bad = await lowContrast(page, 3);
        if (bad.length) {
          report.push(`${t}/${mode}/${tab}: ${bad.join(" | ")}`);
        }
      }
    }
  }
  expect(report).toEqual([]);
  expect(errors).toEqual([]);
});
