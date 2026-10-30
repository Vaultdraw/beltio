import { expect, type Page } from "@playwright/test";

import { openDrawing, openVault, reloadVault } from "../helpers";
import { readTabs } from "../tabsHelpers";

import { journey } from "./journey";

// Journey (bug hunter G, 2026-10-30): an Obsidian-shaped vault where a note and a drawing share a
// name ("Projects/Plan.md" next to "Projects/Plan.excalidraw"), with odd and long names. The user
// opens both in tabs, follows a [[Plan]] link from another note, edits the note and undoes it,
// renames, moves and trashes the open note through the row menu, and checks a narrow window.
// Obsidian is the answer key: [[Plan]] opens the note, a rename or move keeps the open tab on the
// file, and the drawing of the same name is never touched.

const PLAN_TEXT = "# Plan\n\n- [ ] first step\n- [x] done step\n\nBody line.\n";
const HUB_TEXT = "# Hub\n\nSee [[Plan]] for the plan.\n";
const ODD = "Café — ünï 📝 (draft)";
const LONG = `Long ${"abcdefghij".repeat(18)}`;
const LONG_LINE = "x".repeat(400);

const SCENE = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [],
  appState: {},
  files: {},
});

const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

const noteText = (page: Page, p: string) =>
  page.evaluate(
    (x) => (window as any).__noteFiles.textOf(x) as string | undefined,
    p,
  );

const exists = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const repo = (window as any).__vaultRepo;
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    const entries = await repo.listDirectory(repo.handle, dir);
    return entries.some((e: any) => e.path === p);
  }, path);

const menuItem = async (page: Page, path: string, label: string) => {
  const r = row(page, path);
  await r.hover();
  await r.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: label }).click();
};

const seed = (page: Page) =>
  page.evaluate(
    ({ plan, hub, odd, long, longLine, scene }) => {
      const w = window as any;
      const repo = w.__vaultRepo;
      const add = (p: string, t: string) => {
        w.__noteFiles.setOnDisk(p, t);
        repo.seedNote(p);
      };
      repo.seedFolder("Projects");
      repo.seedFolder("Archive");
      add("Projects/Plan.md", plan);
      repo.seedDrawing("Projects/Plan.excalidraw", scene);
      add("Hub.md", hub);
      add(`${odd}.md`, `# ${odd}\n\nAn odd name.\n`);
      add(`${long}.md`, `# Long\n\n${longLine}\n`);
      repo.emit({ handle: repo.handle, paths: [], rescan: true });
    },
    {
      plan: PLAN_TEXT,
      hub: HUB_TEXT,
      odd: ODD,
      long: LONG,
      longLine: LONG_LINE,
      scene: SCENE,
    },
  );

const tabPaths = async (page: Page) =>
  (await readTabs(page)).map((t) => t.path);
const reading = (page: Page) => page.getByTestId("note-reading");
const status = (page: Page) => page.getByTestId("note-status");
const openRow = (page: Page, path: string) =>
  row(page, path).locator(".vault-tree-item__name").click();

journey({
  title: "notes-journey",
  known: [
    {
      match: /the note reading view scrolls sideways on a long line/,
      bug: "toimprove 195 (G-1)",
    },
  ],
  setup: async (page) => {
    await openVault(page, "?seed=obsidian");
    await seed(page);
    await expect(row(page, "Projects")).toBeVisible();
    await row(page, "Projects").locator(".vault-tree-item__toggle").click();
    await expect(row(page, "Projects/Plan.md")).toBeVisible();
    await expect(row(page, "Projects/Plan.excalidraw")).toBeVisible();
  },
  steps: [
    {
      name: "open the note Plan, then the drawing Plan in a new tab: two tabs that can be told apart",
      run: async (page) => {
        await openRow(page, "Projects/Plan.md");
        await expect(
          reading(page).getByRole("heading", { name: "Plan" }),
        ).toBeVisible();
        await page.getByTestId("vault-tab-new").click();
        await openRow(page, "Projects/Plan.excalidraw");
        await expect(
          page.locator(".vault-editor canvas.interactive"),
        ).toBeVisible();
        const tabs = await readTabs(page);
        expect(tabs.map((t) => t.path).sort()).toEqual([
          "Projects/Plan.excalidraw",
          "Projects/Plan.md",
        ]);
        expect(new Set(tabs.map((t) => t.name)).size).toBe(2);
      },
    },
    {
      name: "open Hub: [[Plan]] resolves and a click opens the note, not the drawing",
      run: async (page) => {
        await page.getByTestId("vault-tab-new").click();
        await openRow(page, "Hub.md");
        const link = reading(page).locator("a.wikilink", { hasText: "Plan" });
        await expect(link).toBeVisible();
        await expect(link).not.toHaveClass(/unresolved/);
        await link.click();
        await expect(
          reading(page).getByRole("heading", { name: "Plan" }),
        ).toBeVisible();
        const tabs = await readTabs(page);
        expect(tabs.find((t) => t.active)?.path).toBe("Projects/Plan.md");
        expect(tabs.map((t) => t.path)).toContain("Projects/Plan.excalidraw");
      },
    },
    {
      name: "tick a task in the reading view, then untick it: the file is back as it was",
      run: async (page) => {
        const box = reading(page).getByRole("checkbox").first();
        await box.click();
        await expect
          .poll(() => noteText(page, "Projects/Plan.md"))
          .toContain("- [x] first step");
        await reading(page).getByRole("checkbox").first().click();
        await expect
          .poll(() => noteText(page, "Projects/Plan.md"))
          .toBe(PLAN_TEXT);
      },
    },
    {
      name: "edit the note, then undo the typing: the saved file is back as it was",
      keyboard: true,
      run: async (page) => {
        await page.getByRole("button", { name: "Edit note" }).click();
        const content = page.getByTestId("note-editor").locator(".cm-content");
        await content.click();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type("typed by hand");
        await expect
          .poll(() => noteText(page, "Projects/Plan.md"))
          .toContain("typed by hand");
        await page.keyboard.press("Meta+z");
        await expect(page.getByTestId("note-editor")).not.toContainText(
          "typed by hand",
        );
        await expect
          .poll(() => noteText(page, "Projects/Plan.md"))
          .toBe(PLAN_TEXT);
        await expect(status(page)).toHaveAttribute("data-status", "saved");
        await page.getByRole("button", { name: "Show reading view" }).click();
        await expect(reading(page)).toBeVisible();
      },
    },
    {
      name: "rename the open note Plan to Plan v2: its tab follows, the drawing Plan is untouched",
      run: async (page) => {
        await menuItem(page, "Projects/Plan.md", "Rename…");
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("New name").fill("Plan v2");
        await dialog.getByRole("button", { name: "Rename" }).click();
        await expect(dialog).toHaveCount(0);
        await expect.poll(() => exists(page, "Projects/Plan v2.md")).toBe(true);
        expect(await exists(page, "Projects/Plan.md")).toBe(false);
        expect(await exists(page, "Projects/Plan.excalidraw")).toBe(true);
        await expect
          .poll(async () => tabPaths(page))
          .toEqual(
            expect.arrayContaining([
              "Projects/Plan v2.md",
              "Projects/Plan.excalidraw",
            ]),
          );
        expect(await tabPaths(page)).not.toContain("Projects/Plan.md");
        await expect(
          reading(page).getByRole("heading", { name: "Plan" }),
        ).toBeVisible();
        expect(await noteText(page, "Projects/Plan v2.md")).toBe(PLAN_TEXT);
      },
    },
    {
      name: "move the open note to Archive: its tab follows and still shows the note",
      run: async (page) => {
        await menuItem(page, "Projects/Plan v2.md", "Move to…");
        const dialog = page.getByRole("dialog");
        await expect(dialog).toContainText("Move note");
        await page.keyboard.type("archive");
        await page.keyboard.press("Enter");
        await expect(dialog).toHaveCount(0);
        await expect.poll(() => exists(page, "Archive/Plan v2.md")).toBe(true);
        await expect
          .poll(async () => tabPaths(page))
          .toEqual(
            expect.arrayContaining([
              "Archive/Plan v2.md",
              "Projects/Plan.excalidraw",
            ]),
          );
        expect(await tabPaths(page)).not.toContain("Projects/Plan v2.md");
        await expect(
          reading(page).getByRole("heading", { name: "Plan" }),
        ).toBeVisible();
      },
    },
    {
      name: "trash the open note: its tab goes, the drawing tab stays",
      run: async (page) => {
        // The move may already have unfolded Archive to show the note.
        const moved = row(page, "Archive/Plan v2.md");
        await expect(async () => {
          if (!(await moved.isVisible())) {
            await row(page, "Archive")
              .locator(".vault-tree-item__toggle")
              .click();
          }
          await expect(moved).toBeVisible({ timeout: 1000 });
        }).toPass({ timeout: 10_000 });
        await menuItem(page, "Archive/Plan v2.md", "Move to Trash");
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("button", { name: "Move to Trash" }).click();
        await expect(dialog).toHaveCount(0);
        await expect.poll(() => exists(page, "Archive/Plan v2.md")).toBe(false);
        await expect
          .poll(async () => tabPaths(page))
          .not.toContain("Archive/Plan v2.md");
        expect(await tabPaths(page)).toContain("Projects/Plan.excalidraw");
        expect(await exists(page, "Projects/Plan.excalidraw")).toBe(true);
      },
    },
    {
      name: "odd and long names open, and a 400-character line wraps in a narrow window",
      run: async (page, ctx) => {
        await page.setViewportSize({ width: 720, height: 700 });
        await openRow(page, `${ODD}.md`);
        await expect(
          reading(page).getByRole("heading", { name: ODD }),
        ).toBeVisible();
        await openRow(page, `${LONG}.md`);
        await expect(
          reading(page).getByRole("heading", { name: "Long" }),
        ).toBeVisible();
        const s = await reading(page).evaluate((el) => ({
          reading: el.scrollWidth - el.clientWidth,
          window: document.documentElement.scrollWidth - innerWidth,
        }));
        if (s.reading >= 2) {
          ctx.report("the note reading view scrolls sideways on a long line");
        }
        if (s.window >= 2) {
          ctx.report("the window scrolls sideways on a long line");
        }
        await page.setViewportSize({ width: 1280, height: 800 });
      },
    },
    {
      name: "reload: the app comes back into the vault with the drawing Plan still openable",
      run: async (page) => {
        await reloadVault(page);
        await seed(page);
        await row(page, "Projects").locator(".vault-tree-item__toggle").click();
        await openDrawing(page, "Plan");
        await expect(
          page.locator(".vault-editor canvas.interactive"),
        ).toBeVisible();
      },
    },
  ],
});
