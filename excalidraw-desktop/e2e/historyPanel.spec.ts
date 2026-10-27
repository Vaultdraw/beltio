import { expect, test, type Page } from "@playwright/test";

import { canvasBox, openExportDialogFromMenu, trackErrors } from "./helpers";
import {
  BLUE,
  diag,
  focusInfo,
  callLog,
  colorOn,
  expectColor,
  GREEN,
  MAIN,
  ORANGE,
  openPanelByShortcut,
  panel,
  PREVIEW,
  preview,
  RED,
  recordRepoCalls,
  rectEl,
  rows,
  runPaletteCommand,
  savedLive,
  sceneJson,
  setup,
  waitSaved,
  writeCount,
} from "./historyHelpers";

// Version content: a shared anchor keeps the viewport identical everywhere.
const anchor = rectEl("anc", 0, 0, null, 620, 420, 9);
const a = rectEl("a", 40, 40, RED, 140, 100, 1);
const b = rectEl("b", 220, 40, BLUE, 140, 100, 2);
const c = rectEl("c", 400, 40, ORANGE, 140, 100, 3);
const g = rectEl("g", 40, 260, GREEN, 140, 100, 4);

const V1 = { json: sceneJson([anchor, a]) };
const V2 = { json: sceneJson([anchor, a, b]) };
const V3 = {
  json: sceneJson([anchor, a, b, c]),
  partial: { reason: "checkpoint", name: "Three shapes", note: "all in" },
};

test.beforeEach(async ({ page }) => {
  await setup(page, [anchor, g], [V1, V2, V3]);
});

const selectRow = async (page: Page, index: number) => {
  await rows(page).nth(index).click();
  await expect(preview(page)).toBeVisible();
};

const slider = (page: Page) =>
  page.getByRole("slider", { name: "Version timeline" });

const drawRectangle = async (page: Page) => {
  const box = await canvasBox(page);
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  const x0 = box.x + box.width * 0.55;
  const y0 = box.y + box.height * 0.7;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 60, y0 + 40, { steps: 5 });
  await page.mouse.move(x0 + 140, y0 + 90, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("1");
};

test("opens from the palette and from Mod+Shift+H, lists the versions", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await runPaletteCommand(page, "History: Show or hide history");
  await expect(panel(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(3);
  // Newest first.
  await expect(rows(page).nth(0)).toContainText("Checkpoint: Three shapes");
  await expect(rows(page).nth(0)).toContainText("all in");
  await expect(rows(page).nth(1)).toContainText("Automatic");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);

  await openPanelByShortcut(page);
  await expect(rows(page)).toHaveCount(3);
  await page.keyboard.press("Meta+Shift+KeyH");
  await expect(panel(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("selecting a version shows its content in a preview over the editor", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openPanelByShortcut(page);
  await expect(preview(page)).toHaveCount(0);
  await selectRow(page, 1); // V2: red + blue
  await expectColor(page, PREVIEW, BLUE, true);
  await expectColor(page, PREVIEW, RED, true);
  await expectColor(page, PREVIEW, ORANGE, false);
  await expectColor(page, PREVIEW, GREEN, false);
  await expect(preview(page)).toContainText("Viewing Automatic");
  // The main drawing is untouched underneath.
  await expectColor(page, MAIN, GREEN, true);
  expect(errors).toEqual([]);
});

test("timeline arrows and previous/next commands step the preview", async ({
  page,
}) => {
  await openPanelByShortcut(page);
  await selectRow(page, 0); // V3
  await expectColor(page, PREVIEW, ORANGE, true);
  // Stops: 0 = V1, 1 = V2, 2 = V3, 3 = Current. Every step waits for the
  // slider to report its stop AND for the settled preview before the next
  // input, so a key or command never races the scrub settle timer.
  const atStop = async (stop: number, colour: typeof RED) => {
    await expect(slider(page)).toHaveAttribute("aria-valuenow", String(stop));
    await expectColor(page, PREVIEW, colour, true);
  };
  await atStop(2, ORANGE);

  // Timeline: Left = older.
  await slider(page).focus();
  await page.keyboard.press("ArrowLeft");
  await atStop(1, BLUE);
  await expectColor(page, PREVIEW, ORANGE, false);
  await page.keyboard.press("ArrowLeft");
  await atStop(0, RED);
  await expectColor(page, PREVIEW, BLUE, false);
  await page.keyboard.press("ArrowRight");
  await atStop(1, BLUE);
  await page.keyboard.press("Home"); // oldest
  await atStop(0, RED);
  await expectColor(page, PREVIEW, BLUE, false);

  // Commands: Previous = older, Next = newer.
  await runPaletteCommand(page, "History: Next version");
  await atStop(1, BLUE);
  await runPaletteCommand(page, "History: Next version");
  await atStop(2, ORANGE);
  await runPaletteCommand(page, "History: Previous version");
  await atStop(1, BLUE);
  await expectColor(page, PREVIEW, ORANGE, false);
});

test("End leaves the preview and keeps focus on the slider; re-entering shows the version again", async ({
  page,
}) => {
  await openPanelByShortcut(page);
  await selectRow(page, 1); // V2
  await expectColor(page, PREVIEW, BLUE, true);
  await slider(page).focus();
  await page.keyboard.press("End");
  await expect(preview(page)).toHaveCount(0);
  diag(`focus-after-End ${await focusInfo(page)}`);
  // The track is the role=slider element; focusInfo prints tag.class, not the
  // aria-label, so match the track's class.
  expect(await focusInfo(page)).toContain("vault-history-timeline__track");
  await slider(page).focus();
  await page.keyboard.press("Home");
  // BUG-P1: the preview remounts blank (VersionPreview keeps initialData=null
  // when it first renders before the version is loaded).
  await expect.soft(preview(page)).toBeVisible();
  await expectColor(page, PREVIEW, RED, true);
});

test("Escape leaves the preview, a second Escape closes the panel and refocuses the editor", async ({
  page,
}) => {
  await openPanelByShortcut(page);
  await selectRow(page, 0);
  await page.keyboard.press("Escape");
  await expect(preview(page)).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!document.activeElement?.closest(
            ".vault-editor-container, .vault-editor",
          ),
      ),
    )
    .toBe(true);
  await expectColor(page, MAIN, GREEN, true);
});

test("time travel opens full screen from the palette and the button; Escape returns", async ({
  page,
}) => {
  await runPaletteCommand(page, "History: Time travel");
  await expect(panel(page)).toBeVisible();
  await expect(preview(page)).toBeVisible();
  await expect(preview(page)).toHaveClass(/vault-history-preview--fullscreen/);
  await expect(page.getByTestId("history-timeline")).toBeVisible();
  // Starts at the newest version.
  await expectColor(page, PREVIEW, ORANGE, true);
  diag(`focus-after-palette-time-travel ${await focusInfo(page)}`);
  await page.keyboard.press("Escape");
  // BUG-E1: Escape does nothing in time travel (focus is on the list).
  await expect.soft(preview(page)).toHaveCount(0);
  diag(
    `after-escape preview=${await preview(page).count()} toggle=${await page
      .getByTestId("history-fullscreen")
      .textContent()}`,
  );
  if (await preview(page).count()) {
    await page.getByTestId("history-back").click();
  }
  await expect(preview(page)).toHaveCount(0);
  await expect(panel(page)).toBeVisible();

  // Button: enter, then leave with the same button.
  const toggle = page.getByTestId("history-fullscreen");
  await toggle.click();
  await expect(preview(page)).toHaveClass(/vault-history-preview--fullscreen/);
  await expect(toggle).toHaveText("Exit time travel");
  await toggle.click();
  await expect(toggle).toHaveText("Time travel");
  await expect(preview(page)).not.toHaveClass(/--fullscreen/);
  await toggle.click();
  await expect(preview(page)).toHaveClass(/vault-history-preview--fullscreen/);
  await page.keyboard.press("Escape");
  await expect.soft(preview(page)).toHaveCount(0);
  if (await preview(page).count()) {
    await page.getByTestId("history-back").click();
  }
  await expect(preview(page)).toHaveCount(0);
  await expect(toggle).toHaveText("Time travel");
});

test("Restore > Replace puts the version in the drawing, saves a Before restore version and Cmd+Z undoes it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  // An edit first, so there is something unversioned for the safety snapshot.
  const w0 = await writeCount(page);
  await drawRectangle(page);
  await waitSaved(page, w0);
  const beforeRestore = await savedLive(page);
  expect(beforeRestore.length).toBe(3); // anchor, g, drawn

  await openPanelByShortcut(page);
  await selectRow(page, 1); // V2
  await expectColor(page, PREVIEW, BLUE, true);
  await page.getByTestId("history-restore").click();
  const dialog = page.getByRole("dialog", { name: /^Restore / });
  await expect(dialog).toBeVisible();
  const w1 = await writeCount(page);
  await dialog.getByRole("button", { name: "Replace current drawing" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(preview(page)).toHaveCount(0);

  await expect(page.locator(".vd-toast")).toContainText(
    "Restored version from",
  );
  await expectColor(page, MAIN, BLUE, true);
  await expectColor(page, MAIN, RED, true);
  await expectColor(page, MAIN, GREEN, false);
  await waitSaved(page, w1);
  expect(await savedLive(page)).toEqual(["a", "anc", "b"]);
  await expect(rows(page).filter({ hasText: "Before restore" })).toHaveCount(1);

  // Undo in the main editor brings the pre-restore scene back.
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width - 40, box.y + box.height - 40);
  const w2 = await writeCount(page);
  await page.keyboard.press("Meta+KeyZ");
  await expectColor(page, MAIN, GREEN, true);
  await expectColor(page, MAIN, BLUE, false);
  await waitSaved(page, w2);
  expect(await savedLive(page)).toEqual(beforeRestore);
  expect(errors).toEqual([]);
});

test("Restore as a copy toasts with Open, lists the new file and opens it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await recordRepoCalls(page);
  await openPanelByShortcut(page);
  await selectRow(page, 1); // V2
  const ids = await page.evaluate(
    () =>
      (window as any).__historyRepo
        .allVersions("DSA/Graphs.excalidraw")
        .map((v: any) => v.id) as string[],
  );
  await page.getByTestId("history-restore").click();
  await page
    .getByRole("dialog", { name: /^Restore / })
    .getByRole("button", { name: "Restore as a copy" })
    .click();

  const toast = page.locator(".vd-toast");
  await expect(toast).toContainText("Restored as Graphs (restored");
  expect((await callLog(page)).map((e) => e.method)).toEqual(["restoreCopy"]);
  expect((await callLog(page))[0].id).toBe(ids[1]); // V2 = second created
  // The original drawing is unchanged.
  await expectColor(page, MAIN, GREEN, true);

  await expect(
    page.locator(".vault-tree-item__name", { hasText: "Graphs (restored" }),
  ).toHaveCount(1);
  await toast.getByRole("button", { name: "Open" }).click();
  await expectColor(page, MAIN, BLUE, true);
  await expectColor(page, MAIN, GREEN, false);
  expect(errors).toEqual([]);
});

test("Copy to drawing brings a selected preview shape into the main scene", async ({
  page,
}) => {
  await openPanelByShortcut(page);
  await selectRow(page, 0); // V3
  await expectColor(page, PREVIEW, ORANGE, true);
  const copy = page.getByTestId("history-copy-selection");
  await expect(copy).toBeDisabled();
  const at = await colorOn(page, PREVIEW, ORANGE);
  await page.mouse.click(at.x, at.y);
  await expect(copy).toBeEnabled();
  const w0 = await writeCount(page);
  await copy.click();
  await expect(page.locator(".vd-toast")).toContainText("Copied 1 element");
  await expectColor(page, MAIN, ORANGE, true);
  await waitSaved(page, w0);
  expect(await savedLive(page)).toContain("c");
});

// Native clipboard chords: WebKitGTK fires copy/paste on Ctrl, not Meta (the
// harness only fakes the platform for the app's own shortcuts).
const clipMod = process.platform === "linux" ? "Control" : "Meta";

test("Cmd+C in the preview and Cmd+V in the main editor paste the shape", async ({
  page,
  context,
  browserName,
}) => {
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  }
  await openPanelByShortcut(page);
  await selectRow(page, 0); // V3
  await expectColor(page, PREVIEW, ORANGE, true);
  const at = await colorOn(page, PREVIEW, ORANGE);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId("history-copy-selection")).toBeEnabled();
  await page.keyboard.press(`${clipMod}+KeyC`);

  diag(`focus-in-preview ${await focusInfo(page)}`);
  await page.keyboard.press("Escape"); // back to current
  // BUG-E2: Escape with focus inside the preview does not leave it.
  await expect.soft(preview(page)).toHaveCount(0);
  if (await preview(page).count()) {
    await page.getByTestId("history-back").click();
  }
  await expect(preview(page)).toHaveCount(0);
  await expectColor(page, MAIN, ORANGE, false);
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.75);
  const w0 = await writeCount(page);
  await page.keyboard.press(`${clipMod}+KeyV`);
  await expectColor(page, MAIN, ORANGE, true);
  await waitSaved(page, w0);
});

test("Export as .excalidraw calls the repository with the selected version id", async ({
  page,
}) => {
  await recordRepoCalls(page);
  await openPanelByShortcut(page);
  await selectRow(page, 2); // V1
  const ids = await page.evaluate(
    () =>
      (window as any).__historyRepo
        .allVersions("DSA/Graphs.excalidraw")
        .map((v: any) => v.id) as string[],
  );
  await runPaletteCommand(
    page,
    "Export version as .excalidraw",
    "History: Export version as",
  );
  await expect.poll(async () => (await callLog(page)).length).toBe(1);
  expect(await callLog(page)).toEqual([{ method: "exportFile", id: ids[0] }]);
});

test("Export as image opens the image export dialog from the preview", async ({
  page,
}) => {
  await openPanelByShortcut(page);
  await selectRow(page, 0);
  await expectColor(page, PREVIEW, ORANGE, true);
  await runPaletteCommand(page, "History: Export version as image");
  const modal = page.locator(".ImageExportModal");
  await expect(modal).toBeVisible();
  const box = await modal.boundingBox();
  expect(box!.width).toBeGreaterThan(300);
  expect(box!.height).toBeGreaterThan(200);
  const bg = await modal.evaluate(
    (el) =>
      getComputedStyle(el.closest(".Modal__content") ?? el).backgroundColor,
  );
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  // Centred in the window, opaque, and the backdrop covers panel and navigator.
  const vp = page.viewportSize()!;
  expect(Math.abs(box!.x + box!.width / 2 - vp.width / 2)).toBeLessThan(80);
  expect(Math.abs(box!.y + box!.height / 2 - vp.height / 2)).toBeLessThan(120);
  const backdrop = await page
    .locator(".Modal__background")
    .first()
    .boundingBox();
  expect(backdrop!.x).toBeLessThanOrEqual(1);
  expect(backdrop!.width).toBeGreaterThanOrEqual(vp.width - 2);
  const top = await page.evaluate(
    ({ x, y }) =>
      !!document.elementFromPoint(x, y)?.closest(".Modal, .ImageExportModal"),
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
  );
  expect(top).toBe(true);
  await page.screenshot({
    path: "../.cache/file-history-h2/image-export-dialog.png",
  });
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
});

test("the main editor's own export dialog is unaffected while history is closed", async ({
  page,
}) => {
  await openExportDialogFromMenu(page);
  const box = await page.locator(".ImageExportModal").boundingBox();
  const vp = page.viewportSize()!;
  expect(box!.width).toBeGreaterThan(300);
  expect(Math.abs(box!.x + box!.width / 2 - vp.width / 2)).toBeLessThan(80);
  await page.screenshot({
    path: "../.cache/file-history-h2/image-export-main.png",
  });
});
