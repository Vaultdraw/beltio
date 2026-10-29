import { expect, type Page } from "@playwright/test";

import { openVault } from "../helpers";

import { journey } from "./journey";

// Journey: a big vault (1,200 drawings, 300 notes, six folders deep, accents, emoji, very long names).
// Open it, walk down the folders, search the text, jump with the quick switcher, open several
// drawings one after another, scroll to the end. Obsidian and Zed stay snappy with tens of
// thousands of files. Timings are recorded (TIMINGS line) and only generous budgets are asserted
// (a slow shared machine must not fail this): the aim is to catch a feature that stops scaling.

const BUDGET_MS = {
  show: 20_000,
  expand: 3_000,
  search: 8_000,
  switcher: 5_000,
  open: 6_000,
};

const ODD = [
  "Café notes",
  "日本語ノート",
  "Plan 2026 ✅",
  "résumé — draft",
  "emoji 🎨 board",
  "Ünïcödé",
];
const LONG = `A very long drawing name that goes on and on ${"and on ".repeat(
  18,
)}end`;

const DEEP = "Deep 1/Deep 2/Deep 3/Deep 4/Deep 5";

const build = (page: Page) =>
  page.evaluate(
    ({ odd, long, deep }) => {
      const repo = (window as any).__vaultRepo;
      const scene = (word: string) =>
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          elements: [
            {
              id: "t1",
              type: "text",
              x: 40,
              y: 40,
              width: 200,
              height: 25,
              angle: 0,
              strokeColor: "#1e1e1e",
              backgroundColor: "transparent",
              fillStyle: "solid",
              strokeWidth: 1,
              strokeStyle: "solid",
              roughness: 0,
              opacity: 100,
              groupIds: [],
              frameId: null,
              roundness: null,
              seed: 1,
              version: 1,
              versionNonce: 1,
              isDeleted: false,
              boundElements: [],
              updated: 1,
              link: null,
              locked: false,
              text: word,
              originalText: word,
              fontSize: 20,
              fontFamily: 1,
              textAlign: "left",
              verticalAlign: "top",
              containerId: null,
              lineHeight: 1.25,
            },
          ],
          appState: {},
          files: {},
        });
      let n = 0;
      for (let b = 0; b < 12; b++) {
        const root = `Big ${b} ${b % 2 ? "ü" : "plain"}`;
        for (let i = 0; i < 100; i++) {
          const base = `${odd[(b + i) % odd.length]} ${b}-${i}`;
          repo.seedDrawing(
            `${root}/${deep}/${base}.excalidraw`,
            scene(`unique${n} ${base}`),
          );
          n++;
          if (i % 4 === 0) {
            repo.seedNote(`${root}/${deep}/${base}.md`);
          }
        }
      }
      repo.seedDrawing(
        `Big 0 plain/${long}.excalidraw`,
        scene("long name drawing"),
      );
      repo.emit({ handle: repo.handle, paths: [], rescan: true });
      return n;
    },
    { odd: ODD, long: LONG, deep: DEEP },
  );

const row = (page: Page, path: string) =>
  page.locator(`.vault-tree-item[data-tree-path="${path}"]`);

journey({
  title: "big-vault-journey",
  timeoutMs: 240_000,
  setup: async (page) => {
    await openVault(page, "?seed=empty");
  },
  onTimings: (t, theme) => {
    // eslint-disable-next-line no-console
    console.log(`TIMINGS ${theme} ${JSON.stringify(t)}`);
  },
  steps: [
    {
      name: "1,200 drawings arrive: the first folders show up",
      run: async (page, ctx) => {
        ctx.data.count = await build(page);
        expect(ctx.data.count).toBe(1200);
        await expect(row(page, "Big 0 plain")).toBeVisible({
          timeout: BUDGET_MS.show,
        });
        await expect(row(page, "Big 1 ü")).toBeVisible();
      },
    },
    {
      name: "walk six folders down, one click each",
      run: async (page) => {
        let path = "Big 0 plain";
        await row(page, path).click();
        for (const part of DEEP.split("/")) {
          path += `/${part}`;
          const t0 = Date.now();
          await expect(row(page, path)).toBeVisible({
            timeout: BUDGET_MS.expand,
          });
          expect(Date.now() - t0).toBeLessThan(BUDGET_MS.expand);
          await row(page, path).click();
        }
        await expect(
          page
            .locator(".vault-tree-item__name", { hasText: /^Café notes 0-0$/ })
            .first(),
        ).toBeVisible({ timeout: BUDGET_MS.expand });
      },
    },
    {
      name: "the tree mounts only a window of rows, not 1,300",
      run: async (page) => {
        const mounted = await page
          .locator(".vault-tree-item[data-tree-path]")
          .count();
        expect(mounted).toBeGreaterThan(10);
        expect(mounted, "rows in the page").toBeLessThan(200);
      },
    },
    {
      name: "search the words inside drawings: the right one is found",
      run: async (page) => {
        const search = page.getByPlaceholder("Search drawings and text…");
        await search.fill("unique777");
        await expect(
          page
            .locator(
              '.vault-search-row[data-kind="snippet"], .vault-search-row[data-kind="drawing"]',
            )
            .first(),
        ).toBeVisible({ timeout: BUDGET_MS.search });
        await expect(page.locator(".vault-search-row").first()).toContainText(
          /unique777|Big 7/,
        );
        await search.fill("");
      },
    },
    {
      name: "quick switcher: accents, CJK, emoji and the very long name are found",
      keyboard: true,
      run: async (page) => {
        for (const [q, want] of [
          ["日本語", "日本語ノート"],
          ["résumé", "résumé"],
          ["emoji", "emoji"],
          ["very long", "very long"],
        ] as const) {
          await page.keyboard.press("Meta+KeyP");
          const palette = page.getByRole("dialog", { name: "Command palette" });
          await expect(palette).toBeVisible();
          await page.keyboard.type(q);
          await expect(palette.getByRole("option").first()).toContainText(
            want,
            {
              timeout: BUDGET_MS.switcher,
            },
          );
          await page.keyboard.press("Escape");
          await expect(palette).toHaveCount(0);
        }
      },
    },
    {
      name: "open five drawings one after the other through the switcher",
      keyboard: true,
      run: async (page, ctx) => {
        for (const q of [
          "Ünïcödé 3",
          "Café notes 5",
          "Plan 2026 7",
          "emoji 9",
          "résumé 11",
        ]) {
          const t0 = Date.now();
          await page.keyboard.press("Meta+KeyP");
          await page.keyboard.type(q);
          await expect(
            page
              .getByRole("dialog", { name: "Command palette" })
              .getByRole("option")
              .first(),
          ).toBeVisible({ timeout: BUDGET_MS.switcher });
          await page.keyboard.press("Enter");
          await expect(
            page.locator(".vault-editor canvas.interactive"),
          ).toBeVisible({
            timeout: BUDGET_MS.open,
          });
          await expect(page.locator(".vault-breadcrumbs")).toContainText(
            q.split(" ")[0],
          );
          ctx.timings[`open ${q}`] = Date.now() - t0;
          expect(Date.now() - t0).toBeLessThan(BUDGET_MS.open);
        }
      },
    },
    {
      name: "scroll the tree to the very end and back: the last row mounts, nothing blanks",
      run: async (page) => {
        const container = page.locator(".vault-tree-container");
        await container.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await expect(
          page.locator(".vault-tree-item[data-tree-path]").last(),
        ).toBeVisible();
        const blank = await page.evaluate(() => {
          const c = document.querySelector(
            ".vault-tree-container",
          ) as HTMLElement;
          const rows = c.querySelectorAll(".vault-tree-item[data-tree-path]");
          return rows.length === 0;
        });
        expect(blank, "an empty tree after scrolling").toBe(false);
        await container.evaluate((el) => {
          el.scrollTop = 0;
        });
        await expect(row(page, "Big 0 plain")).toBeVisible();
      },
    },
  ],
});
