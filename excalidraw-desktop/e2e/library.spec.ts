import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import {
  canvasBox,
  openDrawing,
  openVault,
  SHOTS,
  trackErrors,
} from "./helpers";

const GRAPHS = "Graphs";
const INTRO = "01 Introduction";

const drawRectangle = async (page: Page, dx = 0) => {
  const box = await canvasBox(page);
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  const x0 = box.x + box.width * 0.25 + dx;
  const y0 = box.y + box.height * 0.5;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 60, y0 + 40, { steps: 5 });
  await page.mouse.move(x0 + 140, y0 + 90, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("1");
};

const openLibrary = async (page: Page) => {
  if (!(await page.getByTestId("library-section-personal").isVisible())) {
    await page.locator(".default-sidebar-trigger").first().click();
  }
  await expect(page.getByTestId("library-section-personal")).toBeVisible();
};

/** Adding to the library clears the selection, and the sidebar search box
 *  steals keyboard focus: close the sidebar, draw a fresh rectangle (it ends
 *  up selected), reopen the sidebar. */
const drawSelectedRect = async (page: Page, dx = 0) => {
  if (await page.getByTestId("library-section-personal").isVisible()) {
    await page
      .locator(".default-sidebar")
      .getByRole("button", { name: "Close" })
      .click();
    await expect(page.getByTestId("library-section-personal")).toBeHidden();
  }
  await drawRectangle(page, dx);
  await openLibrary(page);
};

const header = (page: Page, id: string) =>
  page.getByTestId(`library-section-${id}`);
const grid = (page: Page, id: string) =>
  header(page, id).locator("xpath=following-sibling::*[1]");
/** The add tile pulses forever (CSS animation), so it is never "stable".
 *  Adding asks for a name (required); Enter adds the item. */
const addTo = async (page: Page, id: string, name = `Item in ${id}`) => {
  await grid(page, id).locator(".library-unit__adder").click({ force: true });
  const input = grid(page, id).getByTestId("library-item-name-input");
  await input.fill(name);
  await input.press("Enter");
};
const itemsIn = (page: Page, id: string) =>
  grid(page, id).locator(
    ".library-unit:not(:has(.library-unit__adder)) .library-unit__dragger",
  );

const fileJson = async (
  page: Page,
  scope: "personal" | "vault",
): Promise<any | null> => {
  const raw = await page.evaluate((s) => {
    const lib = (window as any).__libraryRepo;
    const h = (window as any).__vaultRepo.handle;
    return lib.getJson(s, s === "vault" ? h : undefined);
  }, scope);
  return raw ? JSON.parse(raw) : null;
};
const countIn = async (page: Page, scope: "personal" | "vault") =>
  ((await fileJson(page, scope))?.libraryItems ?? []).length;
const writesLength = (page: Page) =>
  page.evaluate(() => (window as any).__libraryRepo.writes.length as number);

const makeLibJson = (n: number, prefix = "seed") =>
  `(() => {
    const items = [];
    for (let i = 0; i < ${n}; i++) {
      items.push({
        id: "${prefix}-" + i, status: "unpublished", created: 1,
        elements: [{
          id: "${prefix}-el-" + i, type: "rectangle", x: (i % 50) * 3, y: Math.floor(i / 50) * 3,
          width: 40, height: 30, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent",
          fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100,
          groupIds: [], frameId: null, roundness: null, seed: i + 1, version: 1, versionNonce: i + 1,
          isDeleted: false, boundElements: null, updated: 1, link: null, locked: false,
        }],
      });
    }
    return JSON.stringify({ type: "excalidrawlib", version: 2, source: "e2e", libraryItems: items });
  })()`;

const seedPersonal = (page: Page, n: number, prefix = "seed") =>
  page.evaluate(
    ([code]) => {
      // eslint-disable-next-line no-eval
      (window as any).__libraryRepo.setFile("personal", (0, eval)(code));
    },
    [makeLibJson(n, prefix)],
  );

const expandFolder = async (page: Page, name: string) => {
  const row = page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", {
        hasText: new RegExp(`^${name}$`),
      }),
    })
    .first();
  await expect(row).toBeVisible();
  const toggle = row.locator(".vault-tree-item__toggle");
  if ((await toggle.getAttribute("aria-label")) === "Expand") {
    await toggle.click();
  }
};

const setup = async (page: Page) => {
  const errors = trackErrors(page);
  await openVault(page);
  await expandFolder(page, "DSA");
  await expandFolder(page, "Dynamic Programming");
  await openDrawing(page, GRAPHS);
  return errors;
};

test.describe("persisted library", () => {
  test("sections, add, move, copy, no online actions", async ({ page }) => {
    const errors = await setup(page);
    await drawRectangle(page);
    await openLibrary(page);

    await expect(header(page, "personal")).toHaveText("Personal");
    await expect(header(page, "vault")).toHaveText("This vault");
    await expect(page.getByText("Browse libraries")).toHaveCount(0);

    // Add to Personal.
    await addTo(page, "personal");
    await expect.poll(() => countIn(page, "personal")).toBe(1);
    const personal = await fileJson(page, "personal");
    expect(personal.type).toBe("excalidrawlib");
    expect(personal.version).toBe(2);
    expect(Array.isArray(personal.libraryItems)).toBe(true);
    expect(await fileJson(page, "vault")).toBeNull();
    await expect(itemsIn(page, "personal")).toHaveCount(1);

    // Add to This vault (a new selection).
    await drawSelectedRect(page, 200);
    await addTo(page, "vault");
    await expect.poll(() => countIn(page, "vault")).toBe(1);
    expect(await countIn(page, "personal")).toBe(1);
    await expect(itemsIn(page, "vault")).toHaveCount(1);

    // Menu: no Publish, no Browse libraries.
    await page
      .locator(
        ".library-menu-dropdown-container--in-heading [data-testid='dropdown-menu-button']",
      )
      .or(
        page.locator(
          ".library-menu-dropdown-container [data-testid='dropdown-menu-button']",
        ),
      )
      .first()
      .click();
    await expect(page.getByTestId("lib-dropdown--remove")).toHaveCount(0);
    await expect(
      page.getByTestId("lib-dropdown--import-personal"),
    ).toBeVisible();
    await expect(page.getByTestId("lib-dropdown--import-vault")).toBeVisible();
    await page.keyboard.press("Escape");

    // Select the personal item, move it to the vault.
    await itemsIn(page, "personal")
      .first()
      .click({ modifiers: ["Shift"] });
    await page
      .locator(
        ".library-menu-dropdown-container [data-testid='dropdown-menu-button']",
      )
      .first()
      .click();
    await page.getByTestId("lib-dropdown--move-vault").click();
    await expect.poll(() => countIn(page, "vault")).toBe(2);
    await expect.poll(() => countIn(page, "personal")).toBe(0);
    await expect(itemsIn(page, "vault")).toHaveCount(2);

    // Copy the first vault item to Personal.
    await itemsIn(page, "vault")
      .first()
      .click({ modifiers: ["Shift"] });
    await page
      .locator(
        ".library-menu-dropdown-container [data-testid='dropdown-menu-button']",
      )
      .first()
      .click();
    await page.getByTestId("lib-dropdown--copy-personal").click();
    await expect.poll(() => countIn(page, "personal")).toBe(1);
    expect(await countIn(page, "vault")).toBe(2);
    const p = (await fileJson(page, "personal")).libraryItems[0].id;
    const vIds = (await fileJson(page, "vault")).libraryItems.map(
      (i: any) => i.id,
    );
    expect(vIds).not.toContain(p);

    expect(errors).toEqual([]);
  });

  test("external change appears without reload and nothing is lost", async ({
    page,
  }) => {
    const errors = await setup(page);
    await drawRectangle(page);
    await openLibrary(page);
    await addTo(page, "personal");
    await expect.poll(() => countIn(page, "personal")).toBe(1);

    // Local pending edit + external edit: both survive.
    await page.evaluate(
      ([code]) => {
        const lib = (window as any).__libraryRepo;
        // eslint-disable-next-line no-eval
        const ext = JSON.parse((0, eval)(code));
        const cur = JSON.parse(lib.getJson("personal"));
        cur.libraryItems.push(...ext.libraryItems);
        lib.setFile("personal", JSON.stringify(cur));
      },
      [makeLibJson(1, "ext")],
    );
    await expect(itemsIn(page, "personal")).toHaveCount(2);
    await drawSelectedRect(page, 200);
    await addTo(page, "personal");
    await expect.poll(() => countIn(page, "personal")).toBe(3);
    const ids = (await fileJson(page, "personal")).libraryItems.map(
      (i: any) => i.id,
    );
    expect(ids).toContain("ext-0");
    expect(errors).toEqual([]);
  });

  test("switching drawings keeps the library and does not re-read disk", async ({
    page,
  }) => {
    const errors = await setup(page);
    await drawRectangle(page);
    await openLibrary(page);
    await addTo(page, "personal");
    await expect.poll(() => countIn(page, "personal")).toBe(1);
    await page.waitForTimeout(800);

    const reads = () =>
      page.evaluate(
        () => (window as any).__libraryRepo.readLog.length as number,
      );
    const before = await reads();
    const writesBefore = await writesLength(page);
    await openDrawing(page, INTRO);
    await openDrawing(page, GRAPHS);
    await openLibrary(page).catch(() => {});
    await expect(itemsIn(page, "personal")).toHaveCount(1);
    // At most cheap revision checks (unchanged), never a full re-read.
    const log = await page.evaluate(
      (from) => (window as any).__libraryRepo.readLog.slice(from),
      before,
    );
    expect(log.every((r: any) => r.unchanged)).toBe(true);
    expect(await writesLength(page)).toBe(writesBefore);
    expect(errors).toEqual([]);
  });

  test("empty sections line up and the menu sits in the first heading", async ({
    page,
  }) => {
    const errors = await setup(page);
    await openLibrary(page);
    const hint = page.getByText("Items you add here are available");
    const left = async (l: ReturnType<Page["locator"]>) =>
      (await l.boundingBox())!.x;
    expect(
      Math.abs((await left(hint)) - (await left(header(page, "personal")))),
    ).toBeLessThan(2);
    await expect(
      header(page, "personal").getByTestId("dropdown-menu-button"),
    ).toBeVisible();
    await expect(page.locator(".library-menu-items-header")).toHaveCount(0);
    await page
      .locator(".default-sidebar")
      .screenshot({ path: `${SHOTS}/library-empty.png` });
    expect(errors).toEqual([]);
  });

  test("removing one item asks in a compact dialog", async ({ page }) => {
    const errors = await setup(page);
    await drawRectangle(page);
    await openLibrary(page);
    await addTo(page, "personal");
    await expect(itemsIn(page, "personal")).toHaveCount(1);
    await itemsIn(page, "personal")
      .first()
      .click({ modifiers: ["Shift"] });
    await page
      .locator(
        ".library-menu-dropdown-container [data-testid='dropdown-menu-button']",
      )
      .first()
      .click();
    await page
      .locator(".library-menu .dropdown-menu-item")
      .filter({ hasText: /^Remove/ })
      .click();
    const dialog = page.locator(".confirm-dialog .Island");
    await expect(dialog).toContainText(
      "Remove this item from the library? This can't be undone.",
    );
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(440);
    await dialog.screenshot({ path: `${SHOTS}/library-remove-dialog.png` });
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect.poll(() => countIn(page, "personal")).toBe(0);
    expect(errors).toEqual([]);
  });

  test("import into This vault via the native picker, and clear Personal", async ({
    page,
  }) => {
    const errors = await setup(page);
    await openLibrary(page);
    await page.evaluate(
      ([code]) => {
        (window as any).__libraryRepo.pickResult = {
          name: "x.excalidrawlib",
          // eslint-disable-next-line no-eval
          json: (0, eval)(code),
        };
      },
      [makeLibJson(3, "imp")],
    );
    await page
      .locator(
        ".library-menu-dropdown-container [data-testid='dropdown-menu-button']",
      )
      .first()
      .click();
    await page.getByTestId("lib-dropdown--import-vault").click();
    await expect.poll(() => countIn(page, "vault")).toBe(3);
    expect(await fileJson(page, "personal")).toBeNull();
    await expect(itemsIn(page, "vault")).toHaveCount(3);

    // Seed personal externally, then clear it.
    await seedPersonal(page, 2, "pp");
    await expect(itemsIn(page, "personal")).toHaveCount(2);
    await page
      .locator(
        ".library-menu-dropdown-container [data-testid='dropdown-menu-button']",
      )
      .first()
      .click();
    await page.getByTestId("lib-dropdown--clear-personal").click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(() => countIn(page, "personal")).toBe(0);
    expect(await countIn(page, "vault")).toBe(3);
    await expect(itemsIn(page, "vault")).toHaveCount(3);
    expect(errors).toEqual([]);
  });

  test("low-end: 2,000-item library, sidebar open to first item (CPU 6x on chromium)", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "CDP throttling is chromium-only");
    const errors = await setup(page);
    const cdp = await page.context().newCDPSession(page);
    const rate = Number(process.env.E2E_CPU_RATE ?? 6);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    await seedPersonal(page, 2000);
    const t0 = Date.now();
    await page.locator(".default-sidebar-trigger").first().click();
    await expect(
      grid(page, "personal").locator(".library-unit__dragger").first(),
    ).toBeVisible({ timeout: 30_000 });
    const firstItemMs = Date.now() - t0;
    await expect(page.getByTestId("library-section-personal")).toBeVisible();
    // eslint-disable-next-line no-console
    console.log(`LOWEND_RESULT rate=${rate}x first_item_ms=${firstItemMs}`);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    expect(errors).toEqual([]);
  });

  test("sidebar open with 2,000 items (unthrottled, any engine)", async ({
    page,
    browserName,
  }) => {
    const errors = await setup(page);
    await seedPersonal(page, 2000);
    const t0 = Date.now();
    await page.locator(".default-sidebar-trigger").first().click();
    await expect(
      grid(page, "personal").locator(".library-unit__dragger").first(),
    ).toBeVisible({ timeout: 30_000 });
    // eslint-disable-next-line no-console
    console.log(
      `NORMAL_RESULT ${browserName} first_item_ms=${Date.now() - t0}`,
    );
    expect(errors).toEqual([]);
  });

  test("named libraries: create, fold, add, rename, remove", async ({
    page,
  }) => {
    const errors = await setup(page);
    await drawRectangle(page);
    await openLibrary(page);

    // create
    await page.getByTestId("library-new").click();
    await page.getByTestId("library-new-input").fill("Arrows");
    await page.getByTestId("library-new-input").press("Enter");
    const arrows = "lib:personal::Arrows";
    await expect(header(page, arrows)).toHaveText("Arrows");

    // fold and unfold another section
    const fold = page.getByTestId("library-section-fold-personal");
    await fold.click();
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await fold.click();
    await expect(fold).toHaveAttribute("aria-expanded", "true");

    // add an item to it: it lands in Arrows.excalidrawlib
    await drawSelectedRect(page);
    await addTo(page, arrows, "Arrow one");
    await expect(itemsIn(page, arrows)).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(
              (window as any).__libraryRepo.getJson(
                "personal",
                undefined,
                "Arrows",
              ) ?? "{}",
            ).libraryItems?.length ?? 0,
        ),
      )
      .toBe(1);

    // rename
    await page.getByTestId(`library-section-rename-${arrows}`).click();
    const rename = page.getByTestId("library-section-rename-input");
    await rename.fill("Shapes");
    await rename.press("Enter");
    const shapes = "lib:personal::Shapes";
    await expect(header(page, shapes)).toHaveText("Shapes");
    await expect(itemsIn(page, shapes)).toHaveCount(1);

    // remove (the file moves aside, the section goes)
    await page.getByTestId(`library-section-remove-${shapes}`).click();
    await page.getByTestId("library-section-remove-confirm").click();
    await expect(header(page, shapes)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
