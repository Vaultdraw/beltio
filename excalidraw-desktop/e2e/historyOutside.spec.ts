import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { canvasBox, openDrawing, openVault, trackErrors } from "./helpers";

const GRAPHS = "DSA/Graphs.excalidraw";

interface Snap {
  reason: string;
  path: string;
  revision: string;
  json: string;
  /** Whether the conflict badge was still showing when the call arrived. */
  conflictShown: boolean;
  at: number;
}

/**
 * Records every snapshotBytes call on the in-memory history repository and
 * pins what `status().staging` reports. `hang` makes snapshotBytes never
 * resolve (to prove the UI is not blocked by it).
 */
const instrument = (page: Page, opts: { staging: boolean; hang?: boolean }) =>
  page.evaluate(({ staging, hang }) => {
    const repo = (window as any).__historyRepo;
    const snaps: Snap[] = [];
    (window as any).__snaps = snaps;
    const status = repo.status.bind(repo);
    repo.status = async (handle: string) => ({
      ...(await status(handle)),
      staging,
    });
    const original = repo.snapshotBytes.bind(repo);
    repo.snapshotBytes = (
      handle: string,
      path: string,
      reason: string,
      revision: string,
      json: string,
    ) => {
      snaps.push({
        reason,
        path,
        revision,
        json,
        conflictShown: !!document.querySelector(".vault-badge--conflict"),
        at: performance.now(),
      });
      return hang
        ? new Promise(() => {})
        : original(handle, path, reason, revision, json);
    };
  }, opts);

const snaps = (page: Page) =>
  page.evaluate(() => [...((window as any).__snaps ?? [])] as Snap[]);

const historyCalls = (page: Page) =>
  page.evaluate(() => [...(window as any).__historyRepo.calls] as string[]);

const sha256 = (page: Page, text: string) =>
  page.evaluate(async (t) => {
    const d = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(t),
    );
    return [...new Uint8Array(d)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }, text);

const disk = (page: Page) =>
  page.evaluate(async (p) => {
    const repo = (window as any).__vaultRepo;
    const f = await repo.readDrawing(repo.handle, p);
    return { json: f.json as string, revision: f.revision as string };
  }, GRAPHS);

const writeCount = (page: Page) =>
  page.evaluate(() => (window as any).__vaultRepo.writeCalls.length as number);

const drawRectangle = async (page: Page) => {
  const box = await canvasBox(page);
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  const x0 = box.x + box.width * 0.3;
  const y0 = box.y + box.height * 0.6;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 60, y0 + 40, { steps: 5 });
  await page.mouse.move(x0 + 140, y0 + 90, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("1");
};

/** Writes an externally changed copy of the open drawing straight to the vault. */
const externalWrite = (page: Page) =>
  page.evaluate(async (p) => {
    const repo = (window as any).__vaultRepo;
    const scene = JSON.parse((await repo.readDrawing(repo.handle, p)).json);
    scene.elements.push({
      ...scene.elements[0],
      id: "rect-external",
      x: 900,
      y: 500,
    });
    repo.externalWrite(p, JSON.stringify(scene));
  }, GRAPHS);

test.beforeEach(async ({ page }) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
});

const conflictThenReload = async (page: Page) => {
  await drawRectangle(page);
  // Write externally before the serialize window closes: unsaved edits + outside change.
  await externalWrite(page);
  const badge = page.locator(".vault-badge--conflict");
  await expect(badge).toBeVisible({ timeout: 5000 });
  await badge.click();
  const dialog = page.getByRole("dialog", { name: /Conflict/i });
  await expect(dialog).toBeVisible();
  const started = Date.now();
  await dialog.getByRole("button", { name: "Reload from disk" }).click();
  await page
    .getByRole("dialog", { name: "Discard your edits?" })
    .getByRole("button", { name: "Discard and reload" })
    .click();
  await expect(dialog).toHaveCount(0, { timeout: 5000 });
  return Date.now() - started;
};

test("conflict reload that discards edits first sends them as discarded-edits", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await instrument(page, { staging: false });
  await conflictThenReload(page);

  const discarded = (await snaps(page)).filter(
    (s) => s.reason === "discarded-edits",
  );
  expect(discarded).toHaveLength(1);
  const [call] = discarded;
  expect(call.path).toBe(GRAPHS);
  // Sent before the reload replaced the scene (the conflict was still showing).
  expect(call.conflictShown).toBe(true);
  // It is the unsaved scene: it has the new rectangle, not the external one.
  const ids = (JSON.parse(call.json).elements as any[]).map((e) => e.id);
  expect(ids).not.toContain("rect-external");
  const onDisk = JSON.parse((await disk(page)).json).elements as any[];
  expect(ids.length).toBe(onDisk.length); // one drawn here, one external there
  expect(call.json).not.toBe((await disk(page)).json);
  expect(call.revision).toBe(await sha256(page, call.json));
  expect(errors).toEqual([]);
});

test("a snapshotBytes call that never resolves does not block the reload", async ({
  page,
}) => {
  await instrument(page, { staging: true, hang: true });
  const elapsed = await conflictThenReload(page);
  const discarded = (await snaps(page)).filter(
    (s) => s.reason === "discarded-edits",
  );
  expect(discarded).toHaveLength(1);
  // ~300 ms cap plus UI work; generous bound for CI jitter.
  expect(elapsed).toBeLessThan(2500);
});

test("outside change to the open drawing without staging snapshots the saved bytes", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await instrument(page, { staging: false });
  const saved = await disk(page);
  await externalWrite(page);

  await expect.poll(() => snaps(page), { timeout: 5000 }).toHaveLength(1);
  const [call] = await snaps(page);
  expect(call.reason).toBe("before-outside-change");
  expect(call.path).toBe(GRAPHS);
  expect(call.revision).toBe(saved.revision);
  expect(call.json).toBe(saved.json);
  expect(errors).toEqual([]);
});

test("outside change with staging active sends no snapshotBytes", async ({
  page,
}) => {
  await instrument(page, { staging: true });
  await externalWrite(page);
  // The editor adopts the disk version; once that happened the fallback has run.
  await expect
    .poll(
      async () =>
        (await historyCalls(page)).filter((c) => c === "status").length,
      { timeout: 5000 },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(await snaps(page)).toEqual([]);
  expect(await historyCalls(page)).not.toContain("snapshotBytes");
});

test("normal autosave produces no snapshotBytes call", async ({ page }) => {
  await instrument(page, { staging: false });
  const before = await writeCount(page);
  await drawRectangle(page);
  await expect
    .poll(() => writeCount(page), { timeout: 8000 })
    .toBeGreaterThan(before);
  await page.waitForTimeout(500);
  expect(await snaps(page)).toEqual([]);
  expect(await historyCalls(page)).not.toContain("snapshotBytes");
});
