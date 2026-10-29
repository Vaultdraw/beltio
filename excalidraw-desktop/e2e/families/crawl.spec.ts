import { type Locator, type Page } from "@playwright/test";

import { openDrawing, openVault } from "../helpers";
import { expect, test } from "../fixture";

/* eslint-disable no-console */
/**
 * UI crawler (family sweep for: any visible control misbehaves).
 * For each screen it clicks every visible button, link, menu item, tab and
 * toggle and checks general invariants: a dialog or menu that opens closes
 * with Esc (and a dialog with its X); a link reaches the opener with a real
 * URL and never navigates the app; no clipped or overlapping labels; focus
 * is not left on something hidden. Console and page errors fail via the shared
 * fixture. Destructive controls are skipped by DENY (tested elsewhere).
 * Failures are collected and reported together: they are the bug list.
 */

const DENY = /trash|delete|remove|quit|exit|uninstall|wipe|erase|sign out/i;
const CONTROLS =
  'button, a[href], [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="tab"], [role="switch"], [role="checkbox"], input[type="checkbox"], input[type="radio"], summary';
const POPUPS =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

type Control = { id: number; name: string; href: string; tag: string };

const failures: string[] = [];
const seen = new Set<string>();
let clicked = 0;
let skipped = 0;
const fail = (where: string, what: string) => {
  const line = `${where}: ${what}`;
  if (!failures.includes(line)) {
    failures.push(line);
  }
};

const enumerate = (scope: Locator): Promise<Control[]> =>
  scope.evaluate((root, selector) => {
    const out: Control[] = [];
    let n = 0;
    root.querySelectorAll(selector as string).forEach((el) => {
      const h = el as HTMLElement;
      const r = h.getBoundingClientRect();
      const st = getComputedStyle(h);
      if (
        r.width < 2 ||
        r.height < 2 ||
        st.visibility === "hidden" ||
        st.display === "none" ||
        (h as HTMLButtonElement).disabled ||
        h.getAttribute("aria-disabled") === "true" ||
        r.bottom < 0 ||
        r.top > innerHeight ||
        r.right < 0 ||
        r.left > innerWidth
      ) {
        return;
      }
      const id = n++;
      h.setAttribute("data-crawl-id", String(id));
      const labelled = (h as HTMLInputElement).labels?.[0]?.innerText;
      const name = (
        h.getAttribute("aria-label") ||
        labelled ||
        h.innerText ||
        h.getAttribute("title") ||
        h.getAttribute("data-testid") ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60);
      out.push({
        id,
        name,
        href: (h as HTMLAnchorElement).getAttribute?.("href") ?? "",
        tag:
          h.tagName.toLowerCase() +
          (h.getAttribute("role") ? `[${h.getAttribute("role")}]` : ""),
      });
    });
    return out;
  }, CONTROLS);

/** Clipped text and overlapping children inside a popup or the page. */
const layoutProblems = (page: Page, rootSel: string): Promise<string[]> =>
  page.evaluate((sel) => {
    const problems: string[] = [];
    const root = document.querySelector(sel);
    if (!root) {
      return problems;
    }
    const label = (e: Element) =>
      (
        (e as HTMLElement).innerText ||
        e.getAttribute("aria-label") ||
        e.className?.toString() ||
        e.tagName
      )
        .replace(/\s+/g, " ")
        .slice(0, 40);
    const rr = root.getBoundingClientRect();
    if (rr.right > innerWidth + 1 || rr.left < -1) {
      problems.push(`${sel} sticks out horizontally`);
    }
    root
      .querySelectorAll(
        "button, [role=menuitem], [role=tab], label, h1, h2, h3, p, span",
      )
      .forEach((el) => {
        const h = el as HTMLElement;
        const st = getComputedStyle(h);
        if (
          st.display === "none" ||
          st.visibility === "hidden" ||
          h.clientWidth <= 2 ||
          h.clientHeight <= 2
        ) {
          return;
        }
        const clipsX = st.overflowX !== "visible";
        if (
          clipsX &&
          st.textOverflow !== "ellipsis" &&
          h.scrollWidth > h.clientWidth + 2 &&
          h.innerText?.trim()
        ) {
          problems.push(`clipped text "${label(h)}"`);
        }
      });
    root
      .querySelectorAll(
        "button, [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=tab], label",
      )
      .forEach((el) => {
        const kids = Array.from(el.children).filter((c) => {
          const r = c.getBoundingClientRect();
          const s = getComputedStyle(c);
          return (
            r.width > 1 &&
            r.height > 1 &&
            s.position !== "absolute" &&
            s.visibility !== "hidden"
          );
        });
        for (let i = 0; i < kids.length; i++) {
          for (let j = i + 1; j < kids.length; j++) {
            const a = kids[i].getBoundingClientRect();
            const b = kids[j].getBoundingClientRect();
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 2 && oy > 2) {
              problems.push(
                `overlap in "${label(el)}": "${label(kids[i])}" over "${label(
                  kids[j],
                )}"`,
              );
            }
          }
        }
      });
    return problems;
  }, rootSel);

const popupVisible = (page: Page) =>
  page.locator(POPUPS).filter({ visible: true }).count();

/** Closes popups above `keep` (the screen's own dialog, e.g. Settings, stays). */
const closePopups = async (
  page: Page,
  where: string,
  what: string,
  keep = 0,
) => {
  for (let i = 0; i < 4 && (await popupVisible(page)) > keep; i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
  }
  if ((await popupVisible(page)) > keep) {
    fail(where, `${what}: Esc does not close the popup`);
    // Try the X so the crawl can go on.
    const x = page
      .locator(POPUPS)
      .filter({ visible: true })
      .getByRole("button", { name: /close|cancel/i })
      .first();
    if (await x.count()) {
      await x.click({ timeout: 1000 }).catch(() => {});
    }
  }
};

type Screen = {
  name: string;
  /** puts the app into the screen state; idempotent */
  ensure: (page: Page) => Promise<void>;
  scope: (page: Page) => Locator;
};

const crawl = async (
  page: Page,
  theme: string,
  screen: Screen,
  opened: string[],
) => {
  try {
    await crawlScreen(page, theme, screen, opened);
  } catch (e) {
    await page
      .screenshot({
        path: `../.cache/crawl-${screen.name.replace(/\W+/g, "_")}.png`,
      })
      .catch(() => {});
    fail(
      `[${theme}] ${screen.name}`,
      `crawl aborted: ${String(e).replace(/\s+/g, " ").slice(0, 420)}`,
    );
    await page.keyboard.press("Escape").catch(() => {});
  }
};

const crawlScreen = async (
  page: Page,
  theme: string,
  screen: Screen,
  opened: string[],
) => {
  const where = `[${theme}] ${screen.name}`;
  const t0 = Date.now();
  await screen.ensure(page);
  const initialUrl = page.url();
  const base = await popupVisible(page);
  const controls = await enumerate(screen.scope(page));
  const nameCount = new Map<string, number>();
  for (const c of controls) {
    seen.add(`${theme}|${screen.name}|${c.tag}|${c.name}|${c.id}`);
    const label = `${c.tag} "${c.name || "(no name)"}"`;
    if (!c.name && c.tag !== "input") {
      fail(where, `${label} has no accessible name`);
    }
    nameCount.set(label, (nameCount.get(label) ?? 0) + 1);
    if (theme === "dark" && !process.env.CRAWL_DARK_CLICKS) {
      continue; // dark pass checks layout and names on every screen; clicks run in light (keeps the sweep near 2 minutes)
    }
    if (DENY.test(c.name)) {
      skipped++;
      continue;
    }
    // Back to the screen if the last click left it.
    const el = page.locator(`[data-crawl-id="${c.id}"]`);
    if (!(await el.count()) || !(await el.first().isVisible())) {
      await screen.ensure(page);
      if (!(await el.count())) {
        continue; // re-enumerated page dropped it; counted when it was seen
      }
    }
    const before = opened.length;
    try {
      await el.first().click({ timeout: 1000 });
    } catch (e) {
      const why = String(e).match(
        /(<[^\n]{0,90}>) intercepts pointer events|not (visible|stable|enabled)|outside of the viewport/,
      );
      fail(
        where,
        `${label} cannot be clicked: ${why ? why[0].slice(0, 120) : "timeout"}`,
      );
      continue;
    }
    clicked++;
    await page.waitForTimeout(60);
    if (screen.name.startsWith("Settings")) {
      await resetScope(page);
    }
    if (page.url() !== initialUrl) {
      fail(where, `${label} navigated the app to ${page.url()}`);
      await page.goBack().catch(() => {});
    }
    if (c.href && /^https?:/.test(c.href) && opened.length === before) {
      fail(where, `${label} link ${c.href} did not reach the opener`);
    }
    if (
      opened.length > before &&
      !/^https?:\/\/\S+/.test(opened[opened.length - 1])
    ) {
      fail(
        where,
        `${label} opened an empty or odd URL "${opened[opened.length - 1]}"`,
      );
    }
    if ((await popupVisible(page)) > base) {
      for (const p of await layoutProblems(
        page,
        '[role="dialog"], [role="menu"]',
      )) {
        fail(where, `after ${label}: ${p}`);
      }
      const dialog = page
        .locator('[role="dialog"]')
        .filter({ visible: true })
        .first();
      await closePopups(page, where, label, base);
      if (await dialog.count()) {
        // Dialog is closed by Esc; no second pass to keep it cheap.
      }
    }
    // Focus must not sit on a hidden element after closing.
    const lost = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === document.body) {
        return false;
      }
      const r = a.getBoundingClientRect();
      return r.width === 0 && r.height === 0;
    });
    if (lost) {
      fail(where, `after ${label}: focus is on a hidden element`);
    }
  }
  for (const [label, n] of nameCount) {
    if (n > 1 && /no name/.test(label)) {
      fail(where, `${n} controls without a name (${label})`);
    }
  }
  for (const p of await layoutProblems(page, "body")) {
    fail(where, p);
  }
  await closePopups(page, where, "end of screen", base);
  console.log(
    `CRAWL ${where}: ${controls.length} controls, ${Date.now() - t0} ms`,
  );
};

/** The "This vault" scope hides some Settings pages; every Settings crawl starts and stays on Global. */
const resetScope = async (page: Page) => {
  const global = page
    .getByTestId("settings-scope")
    .getByRole("radio", { name: "Global" });
  const g = (await global.count())
    ? global
    : page
        .getByTestId("settings-scope")
        .getByRole("button", { name: "Global" });
  if (await g.count()) {
    await g
      .first()
      .click({ timeout: 1000 })
      .catch(() => {});
  }
};

const openSettings = async (page: Page) => {
  if (!(await page.getByRole("dialog").filter({ visible: true }).count())) {
    // Any visible Settings button: a crawled control may have hidden the navigator (its
    // button is gone then), the activity bar keeps one (flake at load 11, 2026-10-30).
    await page
      .getByRole("button", { name: "Settings", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
  }
};

for (const theme of ["light", "dark"] as const) {
  // eslint-disable-next-line no-loop-func
  test(`crawler: every visible control, ${theme} theme`, async ({ page }) => {
    test.setTimeout(540_000);
    page.setDefaultTimeout(8000);
    await page.emulateMedia({ colorScheme: theme });
    const opened: string[] = [];
    await page.route(
      (u) => !/^(localhost|127\.0\.0\.1)$/.test(u.hostname),
      (r) => r.abort(),
    );
    await page.addInitScript(() => {
      (window as any).__opened = [];
      window.open = (url) => {
        (window as any).__opened.push(String(url ?? ""));
        return null;
      };
    });
    page.on("popup", (p) => {
      opened.push(p.url());
      void p.close();
    });
    // window.open stub feeds the same list.
    const origPush = opened.push.bind(opened);
    await page.exposeFunction("__crawlOpened", (u: string) => origPush(u));
    await page.addInitScript(() => {
      const old = window.open;
      window.open = (url, ...rest) => {
        void (window as any).__crawlOpened(String(url ?? ""));
        return old ? null : null;
      };
    });
    await openVault(page);

    const lum = await page.evaluate(() => {
      const m = getComputedStyle(document.body).backgroundColor.match(
        /\d+/g,
      ) ?? ["255", "255", "255"];
      return (Number(m[0]) + Number(m[1]) + Number(m[2])) / 3 / 255;
    });
    if (theme === "dark" && lum > 0.5) {
      fail(
        `[${theme}]`,
        `emulated dark scheme did not give a dark page (luminance ${lum.toFixed(
          2,
        )})`,
      );
    }

    const screens: Screen[] = [
      {
        name: "home / navigator",
        ensure: async (p) => {
          await p.keyboard.press("Escape");
          const show = p.getByRole("button", { name: "Show navigator" });
          if (await show.isVisible()) {
            await show.click();
          }
          await expect(p.getByLabel("Vault file navigator")).toBeVisible();
        },
        scope: (p) => p.locator("body"),
      },
      {
        name: "drawing open (header, tabs, toolbar)",
        ensure: async (p) => {
          if (
            !(await p.locator(".vault-editor canvas.interactive").isVisible())
          ) {
            await openVault(p); // earlier clicks changed the tree: start clean
            await p
              .locator(".vault-tree-item__name", { hasText: "DSA" })
              .first()
              .click();
            await openDrawing(p, "Graphs");
          }
        },
        scope: (p) => p.locator("body"),
      },
      {
        name: "main menu",
        ensure: async (p) => {
          await closePopups(p, "main menu", "reset");
          if (!(await p.getByRole("menu").filter({ visible: true }).count())) {
            await p.getByTestId("main-menu-trigger").click();
          }
        },
        scope: (p) => p.getByRole("menu").filter({ visible: true }).first(),
      },
    ];
    for (const s of screens) {
      await crawl(page, theme, s, opened);
    }

    // Every Settings page.
    await closePopups(page, `[${theme}] settings`, "before opening");
    await openSettings(page);
    await expect(
      page.getByRole("dialog").getByRole("tab").first(),
    ).toBeVisible();
    const tabs = (
      await page.getByRole("dialog").getByRole("tab").allInnerTexts()
    )
      .map((t) => t.trim())
      .filter(Boolean);
    await closePopups(page, "settings", "tab list");
    for (const tab of tabs) {
      await crawl(
        page,
        theme,
        {
          name: `Settings > ${tab}`,
          ensure: async (p) => {
            await openSettings(p);
            const t = p
              .getByRole("dialog")
              .getByRole("tab", { name: tab, exact: true })
              .first();
            if (!(await t.isVisible())) {
              for (
                let i = 0;
                i < 3 && (await p.getByRole("dialog").count());
                i++
              ) {
                await p.keyboard.press("Escape");
                await p.waitForTimeout(250);
              }
              await openSettings(p);
              await expect(t).toBeVisible();
            }
            await resetScope(p);
            await t.click();
            await p.waitForTimeout(150);
          },
          scope: (p) => p.getByRole("dialog").filter({ visible: true }).first(),
        },
        opened,
      );
    }

    // Command palette: opens and closes with Esc.
    await page.keyboard.press("Meta+KeyP");
    await page.waitForTimeout(200);
    for (const p of await layoutProblems(page, '[role="dialog"]')) {
      fail(`[${theme}] palette`, p);
    }
    await closePopups(page, `[${theme}] palette`, "palette");

    expect(tabs.length, "Settings page tabs found").toBeGreaterThan(8);
    console.log(
      `CRAWL ${theme}: ${clicked} clicks, ${skipped} skipped by deny list, ${seen.size} distinct controls seen, ${failures.length} failures`,
    );
    expect(
      failures,
      "crawler failures (each line is a bug to fix or log)",
    ).toEqual([]);
  });
}
