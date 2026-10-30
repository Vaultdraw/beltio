import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault, trackErrors } from "./helpers";

// How a linked element is marked on the canvas (links.canvas_indicator):
// a line under text, a small corner icon for elements without text, and both
// open the link on click. Screenshots for the owner go to
// personal/feature/link-style/shots/ when LINK_SHOTS is set.

const PATH = "LinkMarker.excalidraw";
const WEB = "https://example.com/web";
const SHOTS = process.env.LINK_SHOTS;

const base = {
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
  isDeleted: false,
  version: 1,
  versionNonce: 1,
  updated: 1,
  locked: false,
};

const text = (id: string, x: number, y: number, t: string, extra = {}) => ({
  ...base,
  id,
  type: "text",
  x,
  y,
  width: 150,
  height: 25,
  seed: 1,
  text: t,
  originalText: t,
  fontSize: 20,
  fontFamily: 2,
  textAlign: "left",
  verticalAlign: "top",
  containerId: null,
  autoResize: true,
  lineHeight: 1.25,
  link: null,
  boundElements: null,
  ...extra,
});

const scene = () =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "e2e-link-marker",
    elements: [
      text("web", 60, 60, "Web link", { link: WEB, width: 90 }),
      text("inner", 60, 130, "Drawing link", {
        link: "[[Other drawing]]",
        width: 120,
      }),
      {
        ...base,
        id: "box",
        type: "rectangle",
        x: 60,
        y: 210,
        width: 180,
        height: 70,
        seed: 2,
        link: WEB,
        boundElements: [{ id: "label", type: "text" }],
      },
      text("label", 110, 233, "Labelled", {
        containerId: "box",
        textAlign: "center",
        verticalAlign: "middle",
        width: 80,
      }),
      {
        ...base,
        id: "plain",
        type: "rectangle",
        x: 60,
        y: 330,
        width: 120,
        height: 60,
        seed: 3,
        link: WEB,
        boundElements: null,
      },
    ],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  });

type View = { scrollX: number; scrollY: number; zoom: number; box: any };

const view = (page: Page): Promise<View> =>
  page.evaluate(() => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
    let fiber = (el as any)[key];
    while (fiber) {
      const s = fiber.stateNode;
      if (s && s.state && s.scene && typeof s.state.scrollX === "number") {
        const els = s.scene.getNonDeletedElements();
        const box: Record<string, number[]> = {};
        for (const e of els) {
          box[e.id] = [e.x, e.y, e.width, e.height];
        }
        return {
          scrollX: s.state.scrollX,
          scrollY: s.state.scrollY,
          zoom: s.state.zoom.value,
          box,
        };
      }
      fiber = fiber.return;
    }
    throw new Error("editor instance not found");
  });

/** Screen point of a scene point. */
const at = async (page: Page, sx: number, sy: number) => {
  const v = await view(page);
  const c = await page
    .locator(".vault-editor canvas.interactive")
    .boundingBox();
  return {
    x: c!.x + (sx + v.scrollX) * v.zoom,
    y: c!.y + (sy + v.scrollY) * v.zoom,
    v,
  };
};

const opened = (page: Page) =>
  page.evaluate(() => (window as any).__opened as string[]);

const clickScene = async (page: Page, sx: number, sy: number) => {
  const p = await at(page, sx, sy);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
};

/** Whether the static canvas has a non-background pixel in a band at a scene point. */
const inkAt = (page: Page, sx: number, sy: number) =>
  page.evaluate(
    ([x, y]) => {
      const el = document.querySelector(".vault-editor canvas.interactive")!;
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
      let fiber = (el as any)[key];
      let st: any = null;
      while (fiber && !st) {
        const s = fiber.stateNode;
        if (s && s.state && typeof s.state.scrollX === "number") {
          st = s.state;
        }
        fiber = fiber.return;
      }
      const canvas = document.querySelector(
        ".vault-editor canvas.static",
      ) as HTMLCanvasElement;
      const dpr = canvas.width / canvas.getBoundingClientRect().width;
      const px = Math.round((x + st.scrollX) * st.zoom.value * dpr);
      const py = Math.round((y + st.scrollY) * st.zoom.value * dpr);
      const d = canvas.getContext("2d")!.getImageData(px, py - 3, 24, 7).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const bright = d[i] + d[i + 1] + d[i + 2];
        const bg = bright > 740 || bright < 40;
        if (d[i + 3] > 0 && !bg) {
          n += 1;
        }
      }
      return n;
    },
    [sx, sy] as const,
  );

const shot = async (page: Page, name: string) => {
  if (!SHOTS) {
    return;
  }
  mkdirSync(SHOTS, { recursive: true });
  await page
    .locator(".vault-editor")
    .screenshot({ path: join(SHOTS, `${name}.png`) });
};

const setIndicator = async (page: Page, label: string) => {
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Links" }).click();
  await dialog.getByLabel("Link marker on the canvas").selectOption({ label });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
};

test("a linked element shows a line or corner icon, in light and dark, and opens on click", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    (window as any).__opened = [];
    window.open = (url) => {
      (window as any).__opened.push(String(url));
      return null;
    };
  });
  await openVault(page);
  await page.evaluate(
    ({ p, j }) => (window as any).__vaultRepo.externalWrite(p, j),
    { p: PATH, j: scene() },
  );
  await openDrawing(page, "LinkMarker");

  const v = await view(page);
  const web = v.box.web;
  const underlineY = web[1] + web[3] - 1;

  // Default "underline": ink under the text, none under a text without a link.
  await expect
    .poll(() => inkAt(page, web[0] + 10, underlineY))
    .toBeGreaterThan(0);
  await shot(page, "after-underline-light");

  // Clicking the line opens the link.
  await clickScene(page, web[0] + 30, underlineY);
  await expect.poll(() => opened(page)).toEqual([WEB]);

  // A shape without text keeps the corner icon, and it opens the link.
  const plain = v.box.plain;
  await clickScene(page, plain[0] + plain[2] + 6, plain[1] - 6);
  await expect.poll(() => opened(page)).toEqual([WEB, WEB]);

  // Dark theme.
  await page.keyboard.press("Shift+Alt+KeyD");
  await expect
    .poll(() => inkAt(page, web[0] + 10, underlineY))
    .toBeGreaterThan(0);
  await shot(page, "after-underline-dark");

  // "Corner icon" only: the line is gone and no longer clickable.
  await setIndicator(page, "Corner icon");
  await expect.poll(() => inkAt(page, web[0] + 10, underlineY)).toBe(0);
  await shot(page, "after-icon-dark");
  const before = (await opened(page)).length;
  await clickScene(page, web[0] + 30, underlineY);
  await page.waitForTimeout(200);
  expect((await opened(page)).length).toBe(before);
  // ...but the corner of the text still opens it.
  await clickScene(page, web[0] + web[2] + 6, web[1] - 6);
  await expect.poll(async () => (await opened(page)).length).toBe(before + 1);

  // "Underline and icon" shows both; light for the owner's screenshots.
  await setIndicator(page, "Underline and icon");
  await expect
    .poll(() => inkAt(page, web[0] + 10, underlineY))
    .toBeGreaterThan(0);
  await page.keyboard.press("Shift+Alt+KeyD");
  await shot(page, "after-both-light");

  expect(errors).toEqual([]);
});
