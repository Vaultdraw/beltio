import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { canvasBox, openVault, readScene, trackErrors } from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Hunter A round 3: pasting while Offline mode is on. Local pastes (a picture file, plain text,
// spreadsheet cells, rich text) behave as when online; web pictures become boxes that say why, one
// per picture; nothing reaches the internet; turning Offline mode off lets the next paste download.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#f00"/></svg>`;
const PIC_A = "https://images.example.org/static/a.png";
const PIC_B = "https://images.example.org/static/b.png";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const FILE = "Offline.excalidraw";

const live = async (page: Page, type: string) =>
  (await readScene(page, FILE)).elements.filter(
    (e: any) => !e.isDeleted && e.type === type,
  );
const texts = async (page: Page) =>
  (await live(page, "text")).map((e: any) =>
    String(e.text).replace(/\s+/g, " "),
  );
const paste = (page: Page, parts: Record<string, string>, png = false) =>
  page.evaluate(
    ([p, withPng, b64]) => {
      const dt = new DataTransfer();
      for (const [k, v] of Object.entries(p as Record<string, string>)) {
        dt.setData(k, v);
      }
      if (withPng) {
        const bytes = Uint8Array.from(atob(b64 as string), (c) =>
          c.charCodeAt(0),
        );
        dt.items.add(new File([bytes], "shot.png", { type: "image/png" }));
      }
      document.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    [parts, png, PNG] as const,
  );

const setOffline = async (page: Page, on: boolean) => {
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.locator(".vault-settings-modal");
  await dialog.getByRole("tab", { name: "General", exact: true }).click();
  await dialog
    .getByRole("switch", { name: "Offline mode", exact: true })
    .setChecked(on, { force: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
};

test("paste while Offline mode is on: local pastes work, web pictures say why, then back online", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  const requests: string[] = [];
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (
      /^https?:$/.test(u.protocol) &&
      !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)
    ) {
      requests.push(req.url());
    }
  });
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await page.evaluate(
    ([svg, a, b]) => {
      const be = (window as any).__plugins.backend;
      be.network.images = {
        [a]: new TextEncoder().encode(svg),
        [b]: new TextEncoder().encode(svg),
      };
    },
    [SVG, PIC_A, PIC_B] as const,
  );
  await seedAndOpen(page, FILE, { elements: [] });
  await setOffline(page, true);
  await expect(page.getByTestId("offline-badge")).toBeVisible();
  const box = await canvasBox(page);
  let n = 0;
  const focus = () =>
    page.mouse.click(box.x + 120 + 180 * n, box.y + 120 + 90 * n++);

  // 1. a picture file
  await focus();
  await paste(page, {}, true);
  await expect
    .poll(async () => (await live(page, "image")).length, { timeout: 10_000 })
    .toBe(1);

  // 2. plain words
  await focus();
  await paste(page, { "text/plain": "plain words offline" });
  await expect
    .poll(async () => await texts(page), { timeout: 10_000 })
    .toContain("plain words offline");

  // 4. rich text with two web pictures: one labelled box per picture, the text kept
  const before = (await live(page, "text")).length;
  await focus();
  await paste(page, {
    "text/html": `<p>Two pics</p><img src="${PIC_A}" alt="Alpha"><img src="${PIC_B}" alt="Beta">`,
    "text/plain": "Two pics",
  });
  await expect
    .poll(async () => (await live(page, "text")).length, { timeout: 15_000 })
    .toBeGreaterThan(before);
  const all = (await texts(page)).join(" | ");
  const boxes = (all.match(/Offline mode is on/g) ?? []).length;
  expect(boxes, `one box per web picture, got: ${all}`).toBe(2);
  expect(requests, "Offline mode sent requests").toEqual([]);

  // 5. back online: the same kind of paste downloads the pictures
  await setOffline(page, false);
  await expect(page.getByTestId("offline-badge")).toHaveCount(0);
  const images = (await live(page, "image")).length;
  await focus();
  await paste(page, {
    "text/html": `<img src="${PIC_A}" alt="Alpha">`,
    "text/plain": "Alpha",
  });
  await expect
    .poll(async () => (await live(page, "image")).length, { timeout: 15_000 })
    .toBeGreaterThan(images);
  expect(errors).toEqual([]);
});

test("spreadsheet cells pasted while Offline mode is on still offer a table", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await seedAndOpen(page, FILE, { elements: [] });
  await setOffline(page, true);
  const box = await canvasBox(page);
  await page.mouse.click(box.x + 120, box.y + 120);
  await paste(page, { "text/plain": "Name\tColour\nApple\tRed\nPear\tGreen" });
  await expect(page.getByText("That looks like a table")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Insert as table" }).click();
  await expect
    .poll(async () => (await live(page, "line")).length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

// A-10: copying a part of a web page (words and a picture) and pasting it keeps only the picture;
// the words are dropped, online as well as offline. Obsidian keeps both. Remove fixme to reproduce.
test("A-10: pasting rich text with a web picture keeps the words", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await page.evaluate(
    ([svg, a]) => {
      (window as any).__plugins.backend.network.images = {
        [a]: new TextEncoder().encode(svg),
      };
    },
    [SVG, PIC_A] as const,
  );
  await seedAndOpen(page, FILE, { elements: [] });
  const box = await canvasBox(page);
  await page.mouse.click(box.x + 150, box.y + 150);
  await paste(page, {
    "text/html": `<p>Words next to the picture</p><img src="${PIC_A}" alt="Alpha">`,
    "text/plain": "Words next to the picture",
  });
  await expect
    .poll(async () => (await live(page, "image")).length, { timeout: 15_000 })
    .toBe(1);
  expect((await texts(page)).join(" | ")).toContain(
    "Words next to the picture",
  );
  expect(errors).toEqual([]);
});
