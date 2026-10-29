import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "./helpers";
import {
  focusCanvas,
  live,
  rect,
  runCommand,
  seedAndOpen,
  setupOf,
} from "./pageHelpers";

// PDF import end to end with the in-memory FakePdfBridge (window.__pdfBridge,
// see harnessMain.tsx): palette/menu/drop entry points, dialog, one-undo commit,
// ranges, cancel, page mode placement, errors, settings, read-only vault.

const DRAWING = "Pdf.excalidraw";
const COMMAND = "Import: PDF…";

type SceneEl = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  locked?: boolean;
  isDeleted?: boolean;
  fileId?: string;
  customData?: Record<string, { name: string; page: number } | undefined>;
};

/** The page an imported picture came from: the plugin keeps it under its data key. */
const source = (e: SceneEl) => e.customData?.["plugins.pdf-import"];

const dialog = (page: Page) => page.getByRole("dialog", { name: "Import PDF" });

/** Replaces the next picked document (n A4 pages) and optional bridge knobs. */
const prepare = (
  page: Page,
  o: {
    pages?: number;
    name?: string;
    delayMs?: number;
    failPages?: number[];
    openError?: string;
    password?: string;
  } = {},
) =>
  page.evaluate((opts) => {
    const b = (window as any).__pdfBridge;
    b.password = opts.password ?? null;
    const pages = Array.from({ length: opts.pages ?? 3 }, () => ({
      widthPt: 595,
      heightPt: 842,
    }));
    b.nextPick = b.makeDoc(opts.name ?? "sample.pdf", pages);
    b.delayMs = opts.delayMs ?? 0;
    b.failPages = new Set(opts.failPages ?? []);
    b.openError = opts.openError ?? null;
  }, o);

const bridgeState = (page: Page) =>
  page.evaluate(() => {
    const b = (window as any).__pdfBridge;
    return {
      closes: [...b.closes] as number[],
      renders: b.renders.length as number,
      token: (b.opened.at(-1) ?? null) as number | null,
    };
  });

const scene = async (page: Page) => {
  const s = await readScene(page, DRAWING);
  return {
    json: s,
    images: (s.elements as SceneEl[]).filter(
      (e) => e.type === "image" && !e.isDeleted,
    ),
  };
};

const waitForImages = async (page: Page, n: number) => {
  await expect
    .poll(async () => (await scene(page)).images.length, { timeout: 15000 })
    .toBe(n);
  return (await scene(page)).images;
};

const liveImages = async (page: Page) =>
  (await live(page)).elements.filter((e) => e.type === "image");

const openAndImport = async (page: Page, range?: string) => {
  await runCommand(page, COMMAND);
  await expect(dialog(page)).toBeVisible();
  if (range !== undefined) {
    await dialog(page)
      .getByPlaceholder(/all, or e\.g\./)
      .fill(range);
  }
  await dialog(page)
    .getByRole("button", { name: "Import", exact: true })
    .click();
};

test.beforeEach(async ({ page }) => {
  await openVault(page);
});

test("palette command: dialog shows name and pages, Import adds 3 locked images in one undo step", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seedAndOpen(page, DRAWING, { elements: [rect("a", 50, 50)] });
  await runCommand(page, COMMAND);
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d).toContainText("sample.pdf");
  await expect(d).toContainText("3 pages");
  await d.getByRole("button", { name: "Import", exact: true }).click();
  await expect(d).toHaveCount(0);
  await expect(page.locator(".vd-toast")).toContainText("Imported 3 pages");

  const images = await waitForImages(page, 3);
  const { json } = await scene(page);
  images.sort((a, b) => source(a)!.page - source(b)!.page);
  expect(images.map((e) => source(e)?.page)).toEqual([1, 2, 3]);
  for (const e of images) {
    expect(e.locked).toBe(true);
    expect(source(e)?.name).toBe("sample.pdf");
    const file = json.files[e.fileId!];
    expect(file.dataURL).toMatch(/^data:image\/jpeg/);
  }
  // one column below the existing rect (bottom y = 130), A4 at 96 dpi
  for (const e of images) {
    expect(e.x).toBe(50);
    expect(e.width).toBeCloseTo((595 * 96) / 72, 0);
    expect(e.height).toBeCloseTo((842 * 96) / 72, 0);
  }
  expect(images[0].y).toBeGreaterThan(130);
  expect(images[1].y).toBeGreaterThan(images[0].y + images[0].height);
  expect(images[2].y).toBeGreaterThan(images[1].y + images[1].height);

  // focus left the closed dialog
  expect(
    await page.evaluate(
      () => !document.activeElement?.closest('[role="dialog"]'),
    ),
  ).toBe(true);

  // the token was closed after the import
  const st = await bridgeState(page);
  expect(st.closes).toContain(st.token);

  // ONE undo removes all three pages
  await focusCanvas(page);
  await page.keyboard.press("Meta+KeyZ");
  await expect.poll(async () => (await liveImages(page)).length).toBe(0);
  await expect.poll(async () => (await scene(page)).images.length).toBe(0);
  expect((await live(page)).elements.map((e) => e.id)).toEqual(["a"]);
  await page.keyboard.press("Meta+Shift+KeyZ");
  await expect.poll(async () => (await liveImages(page)).length).toBe(3);
  expect(errors).toEqual([]);
});

test("main menu item opens the dialog; Escape cancels, closes the token and leaves the scene alone", async ({
  page,
}) => {
  await seedAndOpen(page, DRAWING, { elements: [rect("a", 50, 50)] });
  await page.getByTestId("main-menu-trigger").click();
  await page.getByRole("menuitem", { name: "Import PDF…" }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText("sample.pdf");
  const before = await bridgeState(page);
  expect(before.closes).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect
    .poll(async () => (await bridgeState(page)).closes)
    .toContain(before.token);
  expect((await bridgeState(page)).renders).toBe(0);
  await page.waitForTimeout(400);
  expect((await scene(page)).images).toHaveLength(0);
  expect((await live(page)).elements).toHaveLength(1);
});

test("page range 2-3 imports two pages; an invalid range disables Import with an error", async ({
  page,
}) => {
  await seedAndOpen(page, DRAWING);
  await runCommand(page, COMMAND);
  const d = dialog(page);
  const range = d.getByPlaceholder(/all, or e\.g\./);
  const importBtn = d.getByRole("button", { name: "Import", exact: true });

  await range.fill("abc");
  await expect(importBtn).toBeDisabled();
  await expect(d.getByRole("alert")).toBeVisible();
  await range.fill("9");
  await expect(importBtn).toBeDisabled();
  await expect(d.getByRole("alert")).toBeVisible();

  await range.fill("2-3");
  await expect(importBtn).toBeEnabled();
  await expect(d.getByRole("alert")).toHaveCount(0);
  await expect(d).toContainText("2 pages");
  await importBtn.click();
  const images = await waitForImages(page, 2);
  expect(images.map((e) => source(e)?.page).sort()).toEqual([2, 3]);
});

test("cancel during a slow import commits nothing and closes the token", async ({
  page,
}) => {
  await seedAndOpen(page, DRAWING, { elements: [rect("a", 50, 50)] });
  await prepare(page, { pages: 5, delayMs: 400 });
  await openAndImport(page);
  const d = dialog(page);
  await expect(d.getByRole("progressbar")).toBeVisible();
  await expect(d).toContainText(/Rendering page/);
  await d.getByRole("button", { name: "Cancel" }).click();
  await expect(d).toHaveCount(0);
  const st = await bridgeState(page);
  await expect
    .poll(async () => (await bridgeState(page)).closes)
    .toContain(st.token);
  await page.waitForTimeout(2500);
  expect((await live(page)).elements).toHaveLength(1);
  expect((await scene(page)).images).toHaveLength(0);
  // nothing keeps rendering after the cancel
  const renders = (await bridgeState(page)).renders;
  await page.waitForTimeout(1000);
  expect((await bridgeState(page)).renders).toBe(renders);
});

test("page mode: pages land exactly inside pages 2..4 and the runtime auto-extends one blank trailing page", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const setup = setupOf({ pageCount: 1 });
  await seedAndOpen(page, DRAWING, {
    pageSetup: setup,
    elements: [rect("a", 50, 50)],
  });
  await openAndImport(page);
  await expect(page.locator(".vd-toast")).toContainText("Imported 3 pages");
  const images = await waitForImages(page, 3);
  images.sort((a, b) => a.y - b.y);
  const pitch = setup.height + 40;
  images.forEach((e, k) => {
    const top = (k + 1) * pitch;
    expect(e.x).toBeGreaterThanOrEqual(0);
    expect(e.x + e.width).toBeLessThanOrEqual(setup.width);
    expect(e.y).toBeGreaterThanOrEqual(top);
    expect(e.y + e.height).toBeLessThanOrEqual(top + setup.height);
  });
  // let the page runtime settle (auto-extend runs after commits)
  await page.waitForTimeout(1500);
  const { json } = await scene(page);
  const pageCount = json.appState.pageSetup.pageCount;
  // AUDIT S3 (accepted): content filling the last page makes the page runtime
  // auto-extend by one blank page, as for any content: start + n + 1.
  expect(pageCount).toBe(5);
  // the locked images were not nudged by the enforcement
  const after = (await scene(page)).images.sort((a, b) => a.y - b.y);
  expect(after.map((e) => [e.x, e.y])).toEqual(images.map((e) => [e.x, e.y]));
  expect(errors).toEqual([]);
});

test("encrypted PDF shows the password message and no dialog", async ({
  page,
}) => {
  await seedAndOpen(page, DRAWING);
  await prepare(page, { openError: "PDF_ENCRYPTED" });
  await runCommand(page, COMMAND);
  await expect(page.locator(".vd-toast")).toContainText(/password-protected/);
  await expect(dialog(page)).toHaveCount(0);
  expect((await scene(page)).images).toHaveLength(0);
});

test("password-protected PDF: wrong password is refused, the right one imports the pages", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seedAndOpen(page, DRAWING);
  await prepare(page, { pages: 2, password: "s3cret" });
  await runCommand(page, COMMAND);
  const d = dialog(page);
  await expect(d).toContainText("password-protected");
  const field = d.getByLabel("Password");
  await expect(field).toHaveAttribute("type", "password");
  await expect(field).toBeFocused();
  await field.fill("wrong");
  await field.press("Enter");
  await expect(d.getByRole("alert")).toContainText("Wrong password");
  expect((await scene(page)).images).toHaveLength(0);
  await field.fill("s3cret");
  await field.press("Enter");
  await expect(d.getByLabel("Password")).toHaveCount(0);
  await expect(d).toContainText("2 pages");
  await d.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".vd-toast")).toContainText("Imported 2 pages");
  await waitForImages(page, 2);
  expect(errors).toEqual([]);
});

test("password prompt: Escape cancels without importing and closes the document", async ({
  page,
}) => {
  await seedAndOpen(page, DRAWING);
  await prepare(page, { password: "s3cret" });
  await runCommand(page, COMMAND);
  await expect(dialog(page).getByLabel("Password")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  const st = await bridgeState(page);
  expect(st.closes).toContain(st.token);
  expect((await scene(page)).images).toHaveLength(0);
});

test("a page that fails to render is skipped and reported", async ({
  page,
}) => {
  await seedAndOpen(page, DRAWING);
  await prepare(page, { pages: 3, failPages: [1] });
  await openAndImport(page);
  await expect(page.locator(".vd-toast")).toContainText(
    /Imported 2 pages.*1 page could not be rendered \(2\)/,
  );
  const images = await waitForImages(page, 2);
  expect(images.map((e) => source(e)?.page).sort()).toEqual([1, 3]);
  // no hole: the two pages are stacked one after the other
  images.sort((a, b) => a.y - b.y);
  expect(images[1].y).toBeLessThan(images[0].y + images[0].height + 60);
});

test("dropping a .pdf on the canvas opens the import dialog", async ({
  page,
}) => {
  await seedAndOpen(page, DRAWING);
  await page.evaluate(() => {
    const target = document.querySelector(".vault-editor .excalidraw")!;
    const r = target.getBoundingClientRect();
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File([new TextEncoder().encode("%PDF-1.4\n")], "dropped.pdf", {
        type: "application/pdf",
      }),
    );
    const init = {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    };
    for (const t of ["dragenter", "dragover", "drop"]) {
      target.dispatchEvent(new DragEvent(t, init));
    }
  });
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText("dropped.pdf");
  await dialog(page)
    .getByRole("button", { name: "Import", exact: true })
    .click();
  await waitForImages(page, 3);
});

test("settings: Files page lists the PDF section", async ({ page }) => {
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const modal = page.locator(".vault-settings-modal");
  await expect(modal).toBeVisible();
  await modal.getByRole("tab", { name: "Files" }).click();
  await expect(modal.getByText("PDF import resolution")).toBeVisible();
  await expect(modal.getByText("Lock imported PDF pages")).toBeVisible();
  await expect(modal.getByText("PDF import JPEG quality")).toBeVisible();
});

test("Unlock all makes imported (locked) pages editable", async ({ page }) => {
  await seedAndOpen(page, DRAWING);
  await openAndImport(page);
  await expect(page.locator(".vd-toast")).toContainText(/Unlock all/);
  const images = await waitForImages(page, 3);
  expect(images.every((e) => e.locked)).toBe(true);
  await focusCanvas(page);
  // "Unlock all" has no shortcut (Cmd+Shift+L only toggles a selection); it is
  // offered in the canvas context menu when nothing is selected.
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width - 6, box.y + box.height - 6, {
    button: "right",
  });
  await page.getByRole("button", { name: "Unlock all", exact: true }).click();
  await expect
    .poll(async () => (await scene(page)).images.every((e) => !e.locked))
    .toBe(true);
});

test.describe("lock_pages off", () => {
  test.beforeEach(async ({ page }) => {
    // the vault was opened by the outer beforeEach; reload with the pref seeded
    await page.addInitScript(() => {
      const key = "excalidraw-vault-preferences-v1";
      if (!window.sessionStorage.getItem("pdf-seeded")) {
        window.localStorage.setItem(
          key,
          JSON.stringify({ pdfLockPages: false }),
        );
        window.sessionStorage.setItem("pdf-seeded", "1");
      }
    });
    await openVault(page);
  });

  test("imported pages are not locked and the notice does not mention unlocking", async ({
    page,
  }) => {
    await seedAndOpen(page, DRAWING);
    await openAndImport(page);
    const images = await waitForImages(page, 3);
    expect(images.every((e) => !e.locked)).toBe(true);
    await expect(page.locator(".vd-toast")).toContainText("Imported 3 pages");
    await expect(page.locator(".vd-toast")).not.toContainText(/locked/);
  });
});

test.describe("read-only vault", () => {
  test("Import: PDF is not offered and the menu item is disabled", async ({
    page,
  }) => {
    await openVault(page, "?readonly=1");
    await page
      .locator(".vault-tree-item__name", { hasText: "DSA" })
      .first()
      .click();
    await openDrawing(page, "Graphs");
    await page.keyboard.press("Meta+Shift+KeyP");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    await page.keyboard.type("Import: PDF");
    await page.waitForTimeout(300);
    await expect(
      palette.getByRole("option").filter({ hasText: COMMAND }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByTestId("main-menu-trigger").click();
    const item = page.getByRole("menuitem", { name: "Import PDF…" });
    await expect(item).toBeVisible();
    await expect(item).toBeDisabled();
    await item.click({ force: true }).catch(() => {});
    await expect(dialog(page)).toHaveCount(0);
  });
});

test.describe("extension off", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const key = "excalidraw-vault-preferences-v1";
      if (!window.sessionStorage.getItem("pdf-off-seeded")) {
        window.localStorage.setItem(
          key,
          JSON.stringify({ extPdfImport: false }),
        );
        window.sessionStorage.setItem("pdf-off-seeded", "1");
      }
    });
    await openVault(page);
  });

  test("no command, no menu item, no picker entry and no plugin code loaded", async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await seedAndOpen(page, DRAWING);
    await page.keyboard.press("Meta+Shift+KeyP");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    await page.keyboard.type("Import: PDF");
    await page.waitForTimeout(300);
    await expect(
      palette.getByRole("option").filter({ hasText: COMMAND }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByTestId("main-menu-trigger").click();
    await expect(
      page.getByRole("menuitem", { name: "Import PDF…" }),
    ).toHaveCount(0);
    expect(requests.filter((u) => u.includes("pdf-import"))).toEqual([]);
  });
});
