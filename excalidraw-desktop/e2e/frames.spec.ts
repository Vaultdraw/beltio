import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";
import { rect, seedAndOpen } from "./pageHelpers";

// Frames (official plugin), reached by clicking: the activity bar Frames button opens the panel with the
// drawing's frames in slide order; Present starts the full-screen show; the arrow key moves to the next
// slide and Escape ends it.
const frame = (id: string, x: number, name?: string) => ({
  ...rect(id, x, 0, 400, 300),
  type: "frame",
  name: name ?? null,
  backgroundColor: "transparent",
});

test("Frames: open the panel, Present, next slide, Escape", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await seedAndOpen(page, "Deck.excalidraw", {
    elements: [frame("f1", 0, "Intro"), frame("f2", 600), frame("f3", 1200)],
  });

  await page.getByTestId("activity-bar-frames.list").click();
  const panel = page.getByTestId("frames-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".vd-frames-label")).toHaveText([
    "Intro",
    "Frame 2",
    "Frame 3",
  ]);

  await page.getByTestId("frames-present").click();
  const strip = page.getByTestId("present-strip");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("1 / 3");
  await expect(page.getByTestId("activity-bar-frames.list")).toBeHidden();

  await page.keyboard.press("ArrowRight");
  await expect(strip).toContainText("2 / 3");

  await page.keyboard.press("Escape");
  await expect(strip).toHaveCount(0);
  await expect(page.getByTestId("activity-bar-frames.list")).toBeVisible();
  expect(errors).toEqual([]);
});
