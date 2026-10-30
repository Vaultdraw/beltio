import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { openVault } from "../helpers";

// Launch hunter 2: a seeded random clicker. Random visible controls, in random order, in a vault of
// drawings and notes; nothing destructive. Fails on any console or page error (fixture), and when
// the app shell disappears (blank window) or a dialog is left without a way out.
const SKIP =
  /trash|delete|quit|remove|uninstall|restore|import|install|reset|discard|download|update|sign|backup|erase|clear|empty|replace|overwrite|open vault|switch vault|new vault|setup|close window|check for/i;

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const targets = (page: Page) =>
  page.evaluate(() => {
    const out: { i: number; label: string }[] = [];
    const els = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, [role="menuitem"], [role="tab"], [role="switch"], [role="option"], [role="treeitem"], a[href], input[type="checkbox"], summary, [role="radio"]',
      ),
    );
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (
        r.width < 4 ||
        r.height < 4 ||
        cs.visibility === "hidden" ||
        cs.pointerEvents === "none" ||
        (el as HTMLButtonElement).disabled ||
        r.bottom < 0 ||
        r.top > innerHeight ||
        r.right < 0 ||
        r.left > innerWidth
      ) {
        return;
      }
      const label = (
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.textContent ||
        el.getAttribute("data-testid") ||
        ""
      )
        .trim()
        .slice(0, 60);
      out.push({ i, label });
    });
    (window as any).__monkeyEls = els;
    return out;
  });

for (const seed of [201, 202]) {
  test(`ui monkey ${seed}`, async ({ page }) => {
    test.setTimeout(420_000);
    await openVault(page, "?seed=obsidian");
    await page.evaluate(async () => {
      const repo = (window as any).__vaultRepo;
      for (const [p, t] of [
        ["Inbox/a.md", "# A\n\n- [ ] x #tag [[b]]\n"],
        ["Inbox/b.md", "---\ntags: [x]\n---\nbody [[a]]\n"],
      ]) {
        repo.outside({ op: "create", path: p });
        repo.outside({ op: "modify", path: p, content: t });
      }
    });
    const r = rng(seed);
    const log: string[] = [];
    for (let step = 0; step < 300; step++) {
      const ts = (await targets(page)).filter((t) => !SKIP.test(t.label));
      if (ts.length === 0) {
        await page.keyboard.press("Escape");
        continue;
      }
      const t = ts[Math.floor(r() * ts.length)];
      log.push(`${step}:${t.label}`);
      try {
        await page.evaluate((i) => {
          const el = (window as any).__monkeyEls[i] as HTMLElement;
          el.scrollIntoView({ block: "nearest" });
        }, t.i);
        const box = await page.evaluate((i) => {
          const b = (window as any).__monkeyEls[i].getBoundingClientRect();
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }, t.i);
        await page.mouse.click(box.x, box.y);
      } catch {
        /* element vanished */
      }
      const c = r();
      if (c < 0.2) {
        await page.keyboard.press("Escape");
      } else if (c < 0.45) {
        const L = "abcdefghijklmnoprstuvwxyz,./;'[]\\1234567890";
        const mods = [
          "Meta",
          "Meta+Shift",
          "Meta+Alt",
          "Control",
          "Control+Shift",
          "Alt",
          "Shift",
          "",
        ];
        const m = mods[Math.floor(r() * mods.length)];
        const k = L[Math.floor(r() * L.length)];
        log.push(`key ${m}+${k}`);
        await page.keyboard.press(m ? `${m}+${k}` : k);
      } else if (c < 0.3) {
        await page.keyboard.type("abc #t [[");
        await page.keyboard.press("Escape");
      }
      // The shell is still there, or a dialog covers it.
      const alive = await page.evaluate(
        () =>
          !!document.querySelector(
            ".vault-main, .vault-modal-backdrop, [data-testid='setup']",
          ),
      );
      if (!alive) {
      }
      expect(alive, `shell gone after ${log.slice(-6).join(" | ")}`).toBe(true);
    }
  });
}
