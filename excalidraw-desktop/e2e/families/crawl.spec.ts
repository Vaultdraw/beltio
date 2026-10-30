import { type Locator, type Page } from "@playwright/test";

import { openDrawing, openVault } from "../helpers";
import { rect, setupOf } from "../pageHelpers";
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

/**
 * Controls the crawler never clicks. Every entry has a written reason (test-net, 2026-10-30:
 * entries without one were removed: quit, exit, wipe, erase and sign out match no control in
 * the app; if one appears the crawler will click it and report what happens).
 */
const DENY_LIST: { re: RegExp; reason: string }[] = [
  {
    re: /trash|delete/i,
    reason:
      "destroys a drawing or folder; Move to Trash and Delete are clicked, confirmed and undone by families/daily-use, crud and outside-changes",
  },
  {
    re: /remove/i,
    reason:
      "removes a vault from the recent list, a shortcut or an installed theme; each has its own test (hotkeys, themes, onboarding specs)",
  },
  {
    re: /uninstall/i,
    reason:
      "removes a plugin from the vault; plugin install and uninstall are covered by the plugin specs",
  },
  {
    re: /Import Obsidian vault/i,
    reason:
      "imports a whole folder into the vault (many writes, a progress notice over the page); clicked and checked by families/home-actions",
  },
];
const DENY = new RegExp(DENY_LIST.map((d) => d.re.source).join("|"), "i");
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

// Screens added since the crawler was written (test-net, 2026-10-30): the import entries in the main
// menu, the row menus with Re-import and Update anyway, the "left as they were" list, the plugin
// browser, the theme browser and Install from link. The theme picker is the Appearance page of the
// Settings crawl above. The Markdown mode chip is not in this base (markdown typing is a Settings
// switch only, crawled with the Markdown page); add it here when the chip merges.
const importedText = (id: string, y: number, created: number) => ({
  ...rect(id, 56, y, 300, 30),
  type: "text",
  text: id,
  originalText: id,
  fontSize: 20,
  fontFamily: 5,
  textAlign: "left",
  verticalAlign: "top",
  containerId: null,
  autoResize: true,
  lineHeight: 1.25,
  created,
});

const SEED_ROWS = [
  {
    path: "Obsidian/Import report.excalidraw",
    elements: [importedText("Import report: Obsidian", 56, 7)],
  },
  {
    path: "Obsidian/Poem.excalidraw",
    elements: [
      importedText("Roses are red", 56, 7),
      importedText("Violets are blue", 86, 7),
    ],
  },
  {
    path: "Obsidian/Edited.excalidraw",
    elements: [
      importedText("Imported line", 56, 7),
      importedText("My own line", 86, 99),
    ],
  },
];

for (const theme of ["light", "dark"] as const) {
  // eslint-disable-next-line no-loop-func
  test(`crawler: screens added since, ${theme} theme`, async ({ page }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(8000);
    const start = failures.length;
    await page.emulateMedia({ colorScheme: theme });
    const opened: string[] = [];
    await page.exposeFunction("__crawlOpened2", (u: string) => opened.push(u));
    await page.addInitScript(() => {
      window.open = (url) => {
        void (window as any).__crawlOpened2(String(url ?? ""));
        return null;
      };
    });
    // The catalogues are local fixtures with nothing in them: the dialogs show their empty state.
    await page.route("https://raw.githubusercontent.com/**", (r) => {
      const body = r.request().url().includes("plugin-registry")
        ? { schema: 1, plugins: [] }
        : { schemaVersion: 1, themes: [] };
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(body),
      });
    });
    await openVault(page, "?plugins=markdown-import&config=1");
    await page.waitForFunction(() => (window as any).__pluginsReady === true);
    await page.evaluate(
      ([rows, pageSetup]) => {
        const repo = (window as any).__vaultRepo;
        for (const r of rows as { path: string; elements: unknown[] }[]) {
          repo.seedDrawing(
            r.path,
            JSON.stringify({
              type: "excalidraw",
              version: 2,
              elements: r.elements,
              appState: { pageSetup },
              files: {},
            }),
          );
        }
        repo.emit({ handle: repo.handle, paths: [], rescan: true });
        (window as any).__plugins.backend.folders.sourcePick = {
          name: "Crawl Notes",
          files: { "A.md": "# A\n\nText\n", ".obsidian/app.json": "{}" },
        };
      },
      [SEED_ROWS, setupOf({ paperTheme: "normal" })] as const,
    );
    const tree = (p: Page, name: string) =>
      p.locator(".vault-tree-item__name", { hasText: name }).first();
    const showTree = async (p: Page) => {
      await closePopups(p, "tree", "reset");
      const show = p.getByRole("button", { name: "Show navigator" });
      if (await show.isVisible()) {
        await show.click();
      }
      if (!(await tree(p, "Poem").isVisible())) {
        await tree(p, "Obsidian").click();
      }
      await expect(tree(p, "Poem")).toBeVisible();
    };
    const settingsTab = async (p: Page, tab: string) => {
      await closePopups(p, "settings", "reset", 1);
      await openSettings(p);
      await p
        .getByRole("dialog")
        .getByRole("tab", { name: tab, exact: true })
        .first()
        .click();
    };
    const screens: Screen[] = [
      {
        name: "main menu with the import entries",
        ensure: async (p) => {
          await showTree(p);
          await tree(p, "Poem").click();
          await expect(
            p.locator(".vault-editor canvas.interactive"),
          ).toBeVisible();
          await closePopups(p, "main menu", "reset");
          if (!(await p.getByRole("menu").filter({ visible: true }).count())) {
            await p.getByTestId("main-menu-trigger").click();
          }
        },
        scope: (p) => p.getByRole("menu").filter({ visible: true }).first(),
      },
      {
        name: "row menu: an imported drawing (Re-import, Update anyway)",
        ensure: async (p) => {
          await showTree(p);
          await tree(p, "Poem").click({ button: "right" });
          await expect(p.getByRole("menu")).toBeVisible();
        },
        scope: (p) => p.getByRole("menu").filter({ visible: true }).first(),
      },
      {
        name: "row menu: an imported folder (Re-import unchanged imported notes here)",
        ensure: async (p) => {
          await showTree(p);
          await tree(p, "Obsidian").click({ button: "right" });
          await expect(p.getByRole("menu")).toBeVisible();
        },
        scope: (p) => p.getByRole("menu").filter({ visible: true }).first(),
      },
      {
        name: "Imported notes left as they were (the skipped list)",
        ensure: async (p) => {
          await closePopups(p, "skipped list", "reset");
          const list = p.getByRole("dialog", {
            name: "Imported notes left as they were",
          });
          if (!(await list.isVisible())) {
            await p.keyboard.press("Meta+Shift+KeyP");
            await p.keyboard.type("Update imported notes to my theme");
            await p.keyboard.press("Enter");
            await p
              .getByRole("button", { name: "View list", exact: true })
              .click({ timeout: 20_000 });
          }
          await expect(list).toBeVisible();
        },
        scope: (p) =>
          p.getByRole("dialog", { name: "Imported notes left as they were" }),
      },
      {
        name: "Plugin browser",
        ensure: async (p) => {
          const d = p.getByTestId("plugin-browser-dialog");
          if (!(await d.isVisible())) {
            await settingsTab(p, "Plugins");
            await p
              .getByRole("button", { name: "Browse community plugins…" })
              .click();
          }
          await expect(d).toBeVisible();
        },
        scope: (p) => p.getByTestId("plugin-browser-dialog"),
      },
      {
        name: "Theme browser",
        ensure: async (p) => {
          const d = p.getByTestId("theme-browser-dialog");
          if (!(await d.isVisible())) {
            await settingsTab(p, "Appearance");
            await p
              .getByRole("button", { name: "Install more themes…" })
              .click();
          }
          await expect(d).toBeVisible();
        },
        scope: (p) => p.getByTestId("theme-browser-dialog"),
      },
      {
        name: "Install a theme from a link",
        ensure: async (p) => {
          const d = p.getByTestId("theme-install-dialog");
          if (!(await d.isVisible())) {
            await settingsTab(p, "Appearance");
            await p.getByRole("button", { name: "Install from link…" }).click();
          }
          await expect(d).toBeVisible();
        },
        scope: (p) => p.getByTestId("theme-install-dialog"),
      },
    ];
    for (const s of screens) {
      await crawl(page, theme, s, opened);
      await page.keyboard.press("Escape").catch(() => {});
    }
    // eslint-disable-next-line no-console
    console.log(
      `CRAWL2 ${theme}: ${failures.length - start} failures in ${
        screens.length
      } added screens`,
    );
    expect(
      failures.slice(start),
      "crawler failures on the added screens (each line is a bug to fix or log)",
    ).toEqual([]);
  });
}

// The first-run setup (onboarding-2, 2026-10-31): every control on every step, light and dark, at the
// 1280 and 360 px windows. A step is reached by the real buttons (Get started, Next); clicking a
// control that leaves the step (Next, Back, Skip setup, Open my vault) re-reaches it afterwards.
const SETUP_IDS = [
  "welcome",
  "look",
  "basics",
  "network",
  "extras",
  "vault",
  "done",
] as const;
const SETUP_SIZES = [
  { w: 1280, h: 850 },
  { w: 360, h: 740 },
] as const;
const setupRoot = (p: Page) => p.getByTestId("setup");
const setupStep = (p: Page) =>
  setupRoot(p)
    .getAttribute("data-step", { timeout: 500 })
    .catch(() => null);

/** A first launch: no vault to reopen, no saved answers. */
const freshSetup = async (page: Page) => {
  await page.goto("/e2e.html");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/e2e.html");
  await expect(setupRoot(page)).toBeVisible();
};

const gotoSetupStep = async (page: Page, id: string) => {
  if ((await setupStep(page)) === null) {
    await freshSetup(page);
  }
  for (let i = 0; i < SETUP_IDS.length; i++) {
    const now = await setupStep(page);
    if (now === id) {
      return;
    }
    const cur = SETUP_IDS.indexOf(now as typeof SETUP_IDS[number]);
    const want = SETUP_IDS.indexOf(id as typeof SETUP_IDS[number]);
    await setupRoot(page)
      .locator(cur < want ? ".vault-setup__primary" : ".vault-setup__ghost")
      .filter({ hasText: cur < want ? /./ : /Back/ })
      .first()
      .click();
    await expect(setupRoot(page)).not.toHaveAttribute("data-step", now ?? "");
  }
};

/** The element that draws the focus ring for a control (hidden inputs draw it on their label or row). */
const focusRingProblem = (page: Page, id: number): Promise<string | null> =>
  page.evaluate((n) => {
    const el = document.querySelector(`[data-crawl-id="${n}"]`) as HTMLElement;
    if (!el) {
      return null;
    }
    el.focus();
    const holder =
      el instanceof HTMLInputElement
        ? el.closest("label, .vault-setup__row, .vault-setup__choice") || el
        : el;
    const st = getComputedStyle(holder);
    const ring =
      (st.boxShadow && st.boxShadow !== "none") ||
      (st.outlineStyle !== "none" && parseFloat(st.outlineWidth) > 0);
    return document.activeElement === el && !ring
      ? "no visible focus ring"
      : null;
  }, id);

for (const theme of ["light", "dark"] as const) {
  // eslint-disable-next-line no-loop-func
  test(`crawler: setup screens, ${theme} theme`, async ({ page }) => {
    test.setTimeout(420_000);
    page.setDefaultTimeout(8000);
    const start = failures.length;
    await page.emulateMedia({ colorScheme: theme });
    const opened: string[] = [];
    await page.route(
      (u) => !/^(localhost|127\.0\.0\.1)$/.test(u.hostname),
      (r) => r.abort(),
    );
    await page.exposeFunction("__crawlOpened3", (u: string) => opened.push(u));
    await page.addInitScript(() => {
      window.open = (url) => {
        void (window as any).__crawlOpened3(String(url ?? ""));
        return null;
      };
      let repo: any;
      Object.defineProperty(window, "__vaultRepo", {
        configurable: true,
        get: () => repo,
        set: (v) => {
          repo = v;
          v.reopenVault = async () => null;
        },
      });
    });
    for (const size of SETUP_SIZES) {
      await page.setViewportSize({ width: size.w, height: size.h });
      await freshSetup(page);
      for (const id of SETUP_IDS) {
        const where = `[${theme}] setup > ${id} @${size.w}`;
        await gotoSetupStep(page, id);
        // The step follows the system until the person picks a mode on Look.
        const names = (await enumerate(setupRoot(page))).map((c) => ({
          name: c.name,
          tag: c.tag,
        }));
        for (const c of await enumerate(setupRoot(page))) {
          seen.add(`${theme}|setup ${id}|${c.tag}|${c.name}|${c.id}`);
          if (!c.name) {
            fail(where, `${c.tag} has no accessible name`);
          }
          const ring = await focusRingProblem(page, c.id);
          if (ring) {
            fail(where, `${c.tag} "${c.name}": ${ring}`);
          }
        }
        for (const p of await layoutProblems(page, '[data-testid="setup"]')) {
          fail(where, p);
        }
        const scrollX = await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        );
        if (scrollX > 1) {
          fail(where, `the page scrolls sideways by ${scrollX}px`);
        }
        const card = await page.evaluate(() => {
          const r = document
            .querySelector(".vault-setup__card")!
            .getBoundingClientRect();
          return { left: r.left, right: r.right };
        });
        if (card.left < -1 || card.right > size.w + 1) {
          fail(where, "the card sticks out of the window");
        }
        const heading = await page.evaluate(
          () => document.activeElement?.tagName,
        );
        if (heading !== "H1") {
          fail(where, `focus is on ${heading}, not the heading, on arrival`);
        }

        // Escape goes back (the first step asks about skipping), twice returns.
        if (id === "welcome") {
          await page.keyboard.press("Escape");
          await expect(
            setupRoot(page).getByRole("heading", { name: "Skip the setup?" }),
          ).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(
            setupRoot(page).getByRole("heading", {
              name: /in a folder you own/,
            }),
          ).toBeVisible();
        } else {
          const prev = SETUP_IDS[SETUP_IDS.indexOf(id) - 1]!;
          await page.keyboard.press("Escape");
          if ((await setupStep(page)) !== prev) {
            fail(where, `Escape did not go back to ${prev}`);
          }
          await gotoSetupStep(page, id);
        }

        // Click every control once, by its name; re-reach the step if the click left it.
        const done = new Set<string>();
        for (const n of names) {
          const key = `${n.tag}|${n.name}`;
          if (done.has(key) || DENY.test(n.name)) {
            continue;
          }
          done.add(key);
          await gotoSetupStep(page, id);
          const el = (await enumerate(setupRoot(page))).find(
            (c) => c.tag === n.tag && c.name === n.name,
          );
          if (!el) {
            continue; // the page changed after an earlier click (accent swatches follow the theme)
          }
          const before = opened.length;
          const label = `${n.tag} "${n.name}"`;
          try {
            await page
              .locator(`[data-crawl-id="${el.id}"]`)
              .first()
              .click({ timeout: 1500 });
          } catch (e) {
            fail(
              where,
              `${label} cannot be clicked: ${String(e)
                .replace(/\s+/g, " ")
                .slice(0, 160)}`,
            );
            continue;
          }
          clicked++;
          await page.waitForTimeout(80);
          if (el.href && /^https?:/.test(el.href) && opened.length === before) {
            fail(where, `${label} link ${el.href} did not reach the opener`);
          }
          // A control that opens a dialog (the theme browser): it sits above the setup, closes with Esc, and the setup stays.
          if ((await popupVisible(page)) > 1) {
            for (const p of await layoutProblems(page, '[role="dialog"]')) {
              fail(where, `after ${label}: ${p}`);
            }
            await closePopups(page, where, label, 1);
            if ((await setupStep(page)) !== id) {
              fail(where, `after ${label} and Esc the setup left ${id}`);
            }
          }
        }
        console.log(
          `CRAWL3 ${where}: ${names.length} controls, ${
            failures.length - start
          } failures so far`,
        );
      }
    }
    expect(
      failures.slice(start),
      "crawler failures on the setup screens (each line is a bug to fix or log)",
    ).toEqual([]);
  });
}
