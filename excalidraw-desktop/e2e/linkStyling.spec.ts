import { expect, test, type Page } from "@playwright/test";

import { trackErrors } from "./helpers";
import {
  clusters,
  clusterStats,
  notesScene,
  openSeeded,
  runCommand,
  scanCanvas,
  textElement,
  TOGGLE_STYLING,
  viewportPoint,
} from "./linkStylingHelpers";
import { expectOpen, withMeta } from "./linksHelpers";

// Link styling reads static canvas pixels: link colour (theme accent), the
// underline row, fainter unresolved links; hover preview card; click behaviour.
const FALLBACK_ACCENT_HUE = 242; // #6965db

const drawings = () => ({
  "Notes.excalidraw": notesScene(),
  "Styled.excalidraw": JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "e2e-link-styling",
    elements: [
      textElement("styled-t", "see [[Notes]] and [[Ghost]]", 300, 300),
    ],
    appState: {},
    files: {},
  }),
});

const open = (page: Page) => openSeeded(page, drawings(), "Styled");

/** Scan until the two link clusters appear (the first paint may lag). */
const linkClusters = async (page: Page) => {
  await expect
    .poll(async () => clusters(await scanCanvas(page)).length)
    .toBe(2);
  const scan = await scanCanvas(page);
  return { scan, cs: clusters(scan) };
};

const preview = (page: Page) => page.getByTestId("link-preview");

const hoverLink = async (page: Page, which: 0 | 1) => {
  const { scan, cs } = await linkClusters(page);
  const c = cs[which];
  const st = await clusterStats(page, c);
  // the glyph middle: between the top of the glyphs and the underline
  const p = await viewportPoint(
    page,
    scan,
    (c.x0 + c.x1) / 2,
    (st.topY + st.underlineY) / 2,
  );
  await page.mouse.move(p.x - 40, p.y - 40);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  return p;
};

test("links are drawn in the accent colour with an underline; unresolved are fainter and dashed", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await open(page);
  const { scan, cs } = await linkClusters(page);
  expect(scan.dark).toBeGreaterThan(50); // plain text still in stroke colour
  const accent = await page.evaluate(() => {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue("--vault-primary")
      .trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : null;
  });
  let expectedHue = FALLBACK_ACCENT_HUE;
  if (accent) {
    const [r, g, b] = [1, 3, 5].map((i) =>
      parseInt(accent.slice(i, i + 2), 16),
    );
    const hi = Math.max(r, g, b);
    const d = hi - Math.min(r, g, b);
    const hh =
      hi === r
        ? ((g - b) / d) % 6
        : hi === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
    expectedHue = (hh * 60 + 360) % 360;
  }
  const diff = Math.abs(scan.hue - expectedHue);
  expect(Math.min(diff, 360 - diff)).toBeLessThan(25);

  // underline: a row of link-coloured pixels spanning most of the name.
  // Re-scan on every poll: a late repaint (web font swap) moves the clusters,
  // so stats read from a stale scan can miss the underline.
  let notes = await clusterStats(page, cs[0]);
  let ghost = await clusterStats(page, cs[1]);
  await expect
    .poll(async () => {
      const now = clusters(await scanCanvas(page));
      if (now.length !== 2) {
        return 0;
      }
      notes = await clusterStats(page, now[0]);
      ghost = await clusterStats(page, now[1]);
      return notes.underlineRun / (now[0].x1 - now[0].x0);
    })
    .toBeGreaterThan(0.4);
  // unresolved: fainter and dashed (shorter longest row than the solid one)
  expect(ghost.maxChroma).toBeLessThan(notes.maxChroma * 0.9);
  expect(ghost.underlineRun).toBeLessThan(notes.underlineRun * 0.5);
  expect(errors).toEqual([]);
});

test("Toggle link styling turns the text plain and back", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page);
  await linkClusters(page);
  await runCommand(page, TOGGLE_STYLING);
  await expect.poll(async () => (await scanCanvas(page)).saturated).toBe(0);
  expect((await scanCanvas(page)).dark).toBeGreaterThan(100);
  await runCommand(page, TOGGLE_STYLING);
  await expect
    .poll(async () => (await scanCanvas(page)).saturated)
    .toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test("hovering a resolved link shows its preview card; moving away hides it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await open(page);
  await hoverLink(page, 0);
  const card = preview(page);
  await expect(card).toBeVisible();
  await expect(card).toContainText("Notes");
  await expect(card.locator(".vault-link-preview__meta")).toBeVisible();
  await expect(card.locator("img")).toBeVisible();
  await page.mouse.move(900, 700, { steps: 6 });
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("hovering an unresolved link says the drawing does not exist", async ({
  page,
}) => {
  await open(page);
  await hoverLink(page, 1);
  await expect(preview(page)).toBeVisible();
  await expect(preview(page)).toContainText("No drawing named Ghost");
  await expect(preview(page).locator("img")).toHaveCount(0);
  await page.mouse.move(900, 700, { steps: 6 });
  await expect(preview(page)).toHaveCount(0);
});

test("Cmd+click opens the target, a plain click only selects", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await open(page);
  const p = await hoverLink(page, 0);
  await page.mouse.click(p.x, p.y);
  await expectOpen(page, "Styled");
  await expect(page.locator(".vault-breadcrumbs")).not.toContainText("Notes");
  await page.mouse.move(900, 700, { steps: 4 });
  await withMeta(page, async () => {
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await page.mouse.click(p.x, p.y);
  });
  await expectOpen(page, "Notes");
  expect(errors).toEqual([]);
});
