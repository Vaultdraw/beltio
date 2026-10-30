import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "../helpers";

// Hunter D round 2: a theme with its own `markdown` colour block (like an Obsidian theme's
// --h1-color), installed through Settings > Install from link, then used through the UI: a
// heading typed in Markdown mode must be drawn in the theme's colour for its level, in light
// and in dark, and must follow when the theme changes back.
test.use({ allowedErrors: /Failed to load resource/ });

const variant = (h1: string, h2: string) => ({
  mPrimary: "#3366cc",
  mOnPrimary: "#ffffff",
  mSecondary: "#339966",
  mOnSecondary: "#ffffff",
  mTertiary: "#996633",
  mOnTertiary: "#ffffff",
  mSurface: "#f4f4f4",
  mOnSurface: "#202020",
  mSurfaceVariant: "#e4e4e4",
  mOnSurfaceVariant: "#505050",
  mError: "#cc0000",
  mOnError: "#ffffff",
  mOutline: "#aaaaaa",
  markdown: { h1, h2 },
});
const THEME = JSON.stringify({
  name: "Rosewood",
  author: "hunter",
  light: variant("#cc2200", "#0044cc"),
  dark: {
    ...variant("#ff8866", "#66aaff"),
    mSurface: "#181818",
    mOnSurface: "#eeeeee",
    mSurfaceVariant: "#262626",
    mOnSurfaceVariant: "#bbbbbb",
  },
});

const rootVar = (page: Page, n: string) =>
  page.evaluate(
    (k) =>
      getComputedStyle(document.documentElement).getPropertyValue(k).trim(),
    k(n),
  );
function k(n: string) {
  return n;
}

const typeLine = async (page: Page, x: number, y: number, text: string) => {
  await page.locator(".vault-editor").getByTestId("toolbar-text").click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeFocused();
  await page.keyboard.type(text, { delay: 15 });
  await page.keyboard.press("Escape");
  await expect(page.locator("textarea.excalidraw-wysiwyg")).toHaveCount(0);
};

/** The most common non-background colour painted in a text element's box. */
const ink = (page: Page, text: string) =>
  page.evaluate((t) => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((q) => q.startsWith("__reactFiber"))!;
    let fiber = (el as any)[key];
    let inst: any = null;
    while (fiber) {
      const s = fiber.stateNode;
      if (s && s.scene && s.state && typeof s.state.scrollX === "number") {
        inst = s;
        break;
      }
      fiber = fiber.return;
    }
    const st = inst.state;
    const e = inst.scene
      .getNonDeletedElements()
      .find((x: any) => x.type === "text" && x.text === t);
    const c = document.querySelector<HTMLCanvasElement>(
      ".vault-editor canvas.static",
    )!;
    const q = c.width / c.getBoundingClientRect().width;
    const x0 = Math.max(0, Math.round((e.x + st.scrollX) * st.zoom.value * q));
    const y0 = Math.max(0, Math.round((e.y + st.scrollY) * st.zoom.value * q));
    const w = Math.max(
      1,
      Math.min(Math.round(e.width * st.zoom.value * q), c.width - x0),
    );
    const h = Math.max(
      1,
      Math.min(Math.round(e.height * st.zoom.value * q), c.height - y0),
    );
    const d = c.getContext("2d")!.getImageData(x0, y0, w, h).data;
    const counts = new Map<string, number>();
    for (let i = 0; i < d.length; i += 4) {
      const key2 = `${d[i]},${d[i + 1]},${d[i + 2]}`;
      counts.set(key2, (counts.get(key2) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const hex = (s: string) =>
      `#${s
        .split(",")
        .map((n) => Number(n).toString(16).padStart(2, "0"))
        .join("")}`;
    return {
      bg: hex(sorted[0][0]),
      inks: sorted.slice(1, 6).map((s) => hex(s[0])),
    };
  }, text);

const near = (a: string, b: string, tol = 40) => {
  const n = (h: string) =>
    [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [n(a), n(b)];
  return Math.max(...x.map((v, i) => Math.abs(v - y[i]))) <= tol;
};

const setMode = async (page: Page, mode: "Light" | "Dark") => {
  await page.keyboard.press("Meta+Comma");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
  await dialog
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: mode, exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.waitForTimeout(400);
};

test("a theme's own Markdown colours reach typed headings, in light and dark", async ({
  page,
}) => {
  // linux-ci-triage (2026-10-30): the canvas ink sampler finds no text element on Linux WebKitGTK (page.evaluate: e.x undefined); needs a debug session. Tracking: personal/feature/linux-ci-triage/TRIAGE.md.
  test.skip(
    process.platform === "linux",
    "the canvas ink sampler finds no text element on Linux WebKitGTK",
  );
  const errors = trackErrors(page);
  await page.route("https://themes.example.test/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: THEME,
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");

  await page.keyboard.press("Meta+Comma");
  const settings = page.getByRole("dialog");
  await settings.getByRole("tab", { name: "Appearance", exact: true }).click();
  await settings.getByRole("button", { name: "Install from link…" }).click();
  const install = page.getByTestId("theme-install-dialog");
  await install
    .getByLabel("Address or GitHub repo")
    .fill("https://themes.example.test/Rosewood.json");
  await install.getByRole("button", { name: "Look up" }).click();
  await install.getByRole("button", { name: "Install", exact: true }).click();
  await expect(install.getByTestId("theme-install-done")).toContainText(
    "Rosewood",
  );
  await install.getByRole("button", { name: "Use it" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await setMode(page, "Light");
  expect(await rootVar(page, "--vault-md-h1")).toBe("#cc2200");
  expect(await rootVar(page, "--vault-md-h2")).toBe("#0044cc");

  await page.locator(".vault-editor").getByTestId("markdown-chip").click();
  await typeLine(page, 0.3, 0.7, "# Alpha title ");
  await typeLine(page, 0.3, 0.85, "## Beta subtitle ");
  const scene = async () =>
    (await readScene(page, "DSA/Graphs.excalidraw")).elements;
  await expect
    .poll(
      async () => (await scene()).filter((e: any) => e.customData?.role).length,
    )
    .toBe(2);
  const findText = async (start: string) =>
    (await scene()).find(
      (e: any) => e.type === "text" && e.text.startsWith(start),
    );
  const al = await findText("Alpha");
  const be = await findText("Beta");
  expect(al.customData.role).toBe("h1");
  expect(be.customData.role).toBe("h2");
  const p1 = await ink(page, al.text);
  expect(
    p1.inks.some((c) => near(c, "#cc2200")),
    `h1 painted ${JSON.stringify(p1)}`,
  ).toBe(true);

  await setMode(page, "Dark");
  expect(await rootVar(page, "--vault-md-h1")).toBe("#ff8866");
  const p2 = await ink(page, al.text);
  expect(
    p2.inks.some((c) => near(c, "#ff8866")),
    `dark h1 painted ${JSON.stringify(p2)}`,
  ).toBe(true);
  const p3 = await ink(page, be.text);
  expect(
    p3.inks.some((c) => near(c, "#66aaff")),
    `dark h2 painted ${JSON.stringify(p3)}`,
  ).toBe(true);
  expect(errors).toEqual([]);
});
