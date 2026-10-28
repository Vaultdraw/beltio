import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "../fixture";

import { openVault } from "../helpers";

// Family: every notice, toast, banner, alert and progress message looks like the
// one design, closes on X and on Esc, closes by itself when routine, and speaks
// plain words (no internal codes, no command names). One row per kind of notice.

type Member = {
  name: string;
  /** Makes the app show the notice (through visible UI where the app does). */
  trigger: (page: Page) => Promise<void>;
  /** The plain wording the user must see. */
  text: RegExp;
  /** Progress notices wait for their work instead of closing by themselves. */
  staysWhileWorking?: boolean;
  /** Notices with buttons stay about 8 s so the buttons can be reached. */
  hasButtons?: boolean;
};

/** Wording that must never reach a notice. */
const FORBIDDEN =
  /(Failed to|\(Import:|Cmd\+|Ctrl\+|undefined|\[object|\bE[A-Z]{4,}\b|NOT_FOUND|IO_ERROR)/;

/** Button labels cross into the page; their handlers are built there. */
const push = (page: Page, input: { actions?: string[] } & object) =>
  page.evaluate(
    (i: any) =>
      (window as any).__vaultToasts.push({
        ...i,
        actions: i.actions?.map((label: string) => ({ label, run() {} })),
      }),
    input,
  );

const treeRow = (page: Page, name: string) =>
  page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", {
        hasText: new RegExp(`^${name}$`),
      }),
    })
    .first();

const failRepo = (page: Page, method: string, message: string) =>
  page.evaluate(
    ([m, msg]) => {
      (window as any).__vaultRepo[m] = async () => {
        throw new Error(msg);
      };
    },
    [method, message],
  );

const members: Member[] = [
  {
    name: "move to the Trash fails (row menu, confirm)",
    trigger: async (page) => {
      await failRepo(page, "trash", "disk is full");
      const row = treeRow(page, "Graphs");
      await row.hover();
      await row.getByRole("button", { name: "More actions" }).click();
      await page
        .getByRole("menuitem", { name: "Move to Trash", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Move to Trash" })
        .click();
    },
    text: /Couldn't move "Graphs(\.excalidraw)?" to the Trash: .*disk is full/,
  },
  {
    name: "create a folder fails (New Folder dialog)",
    trigger: async (page) => {
      await failRepo(page, "createFolder", "read-only volume");
      await page.getByRole("button", { name: "New Folder" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill("Nope");
      await dialog.getByRole("button", { name: "Create" }).click();
    },
    text: /Couldn't create the folder "Nope": .*read-only volume/,
  },
  {
    name: "rename fails (row menu, Rename dialog)",
    trigger: async (page) => {
      await failRepo(page, "move", "name is taken");
      const row = treeRow(page, "Graphs");
      await row.hover();
      await row.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("New name").fill("Other");
      await dialog.getByRole("button", { name: "Rename" }).click();
    },
    text: /Couldn't rename "Graphs(\.excalidraw)?": .*name is taken/,
  },
  {
    name: "plain error toast (store)",
    trigger: (page) =>
      push(page, {
        message: "Couldn't save the config: disk is full",
        kind: "error",
      }),
    text: /Couldn't save the config/,
  },
  {
    name: "info toast (store)",
    trigger: (page) => push(page, { message: "Copied the link" }),
    text: /Copied the link/,
  },
  {
    name: "title, detail and two buttons (store)",
    trigger: (page) =>
      push(page, {
        message: "Imported 571 notes",
        detail: "3 images left as boxes",
        actions: ["View report", "Undo"],
      }),
    text: /Imported 571 notes/,
    hasButtons: true,
  },
  {
    name: "progress with count and Cancel (store)",
    trigger: (page) =>
      push(page, {
        message: "Importing notes",
        key: "sweep-progress",
        detail: "taskflow.puml",
        progress: { done: 1719, total: 1855 },
        actions: ["Cancel"],
      }),
    text: /Importing notes/,
    staysWhileWorking: true,
  },
];

const noticeOf = (page: Page, member: Member): Locator =>
  page.locator(".vd-toast").filter({ hasText: member.text });

test.describe("notices family", () => {
  test.beforeEach(async ({ page }) => {
    await openVault(page);
    await page
      .locator(".vault-tree-item")
      .filter({
        has: page.locator(".vault-tree-item__name", { hasText: /^DSA$/ }),
      })
      .first()
      .locator(".vault-tree-item__toggle")
      .click();
    await page.evaluate(() =>
      (window as any).__updatePreferences({ noticeSeconds: 1 }),
    );
  });

  for (const member of members) {
    test(member.name, async ({ page }) => {
      const notice = noticeOf(page, member);

      // 1. Appears as a small corner notice in plain words; no full-width bar.
      await member.trigger(page);
      await expect(notice).toBeVisible();
      expect(await notice.innerText()).not.toMatch(FORBIDDEN);
      await expect(page.locator(".vault-global-alert")).toHaveCount(0);
      const box = await notice.boundingBox();
      expect(box!.width).toBeLessThan(420);

      // 2. Progress shows a bar and a count; buttons are real buttons.
      if (member.staysWhileWorking) {
        await expect(notice.locator("progress")).toHaveCount(1);
        await expect(notice).toContainText("1719 / 1855");
        await expect(
          notice.getByRole("button", { name: "Cancel" }),
        ).toBeVisible();
      }

      // 3. Closes on X.
      await notice
        .getByRole("button", { name: "Dismiss notification" })
        .click();
      await expect(notice).toHaveCount(0);

      // 4. Closes on Esc while focused.
      await member.trigger(page);
      await expect(notice).toBeVisible();
      await notice
        .getByRole("button", { name: "Dismiss notification" })
        .focus();
      await page.keyboard.press("Escape");
      await expect(notice).toHaveCount(0);

      // 5. Routine notices close by themselves (interface.notice_seconds = 1;
      // info toasts keep their own 5 s); progress waits for its work.
      await member.trigger(page);
      await expect(notice).toBeVisible();
      // A pointer resting on a notice pauses it: park the pointer elsewhere.
      await page.mouse.move(5, 5);
      if (member.staysWhileWorking) {
        await page.waitForTimeout(2500);
        await expect(notice).toBeVisible();
      } else {
        await expect(notice).toHaveCount(0, {
          timeout: member.hasButtons ? 12000 : 8000,
        });
      }
    });
  }

  test("notice_seconds = 0 keeps an error until it is dismissed", async ({
    page,
  }) => {
    await page.evaluate(() =>
      (window as any).__updatePreferences({ noticeSeconds: 0 }),
    );
    const member = members[3];
    await member.trigger(page);
    const notice = noticeOf(page, member);
    await page.waitForTimeout(2500);
    await expect(notice).toBeVisible();
    await notice.getByRole("button", { name: "Dismiss notification" }).click();
    await expect(notice).toHaveCount(0);
  });

  test("hovering a notice pauses its countdown", async ({ page }) => {
    const member = members[3];
    await member.trigger(page);
    const notice = noticeOf(page, member);
    await notice.hover();
    await page.waitForTimeout(2500);
    await expect(notice).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(notice).toHaveCount(0, { timeout: 6000 });
  });
});
