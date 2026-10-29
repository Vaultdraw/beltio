import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import {
  clickMainMenuItem,
  openVault,
  readScene,
  trackErrors,
} from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Bug hunter A (2026-10-30): Markdown import scenarios that cross features.
const row = (page: Page, path: string) =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );

const textsOf = async (page: Page, path: string): Promise<string[]> =>
  (await readScene(page, path)).elements
    .filter((e: any) => e.type === "text" && !e.isDeleted)
    .map((e: any) => e.text as string);

test("hunt: Re-import from a non-active tab's menu rewrites the clicked tab's note", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  const pick = (a: string, b: string) =>
    page.evaluate(
      ([x, y]) => {
        (window as any).__plugins.backend.folders.sourcePick = {
          name: "Vault",
          files: { "Alpha.md": x, "Beta.md": y },
        };
      },
      [a, b],
    );
  await pick("alpha v1", "beta v1");
  await clickMainMenuItem(page, "Import Obsidian vault…");
  await expect(row(page, "Vault")).toBeVisible({ timeout: 30_000 });
  await row(page, "Vault/Alpha.excalidraw").click();
  await row(page, "Vault/Beta.excalidraw").click({ modifiers: ["Meta"] });
  await expect(
    page.locator('[data-testid="vault-tab"][data-active="true"]'),
  ).toContainText("Beta");
  await pick("alpha v2", "beta v2");
  // Right-click the Alpha tab (Beta is the active one).
  await page
    .getByTestId("vault-tab")
    .filter({ hasText: "Alpha" })
    .click({ button: "right" });
  await page
    .getByTestId("vault-tab-menu")
    .getByRole("menuitem", {
      name: "Markdown: Re-import this note from its Markdown",
    })
    .or(
      page
        .getByTestId("vault-tab-menu")
        .getByRole("menuitem", { name: "Re-import from its Markdown" }),
    )
    .first()
    .click();
  await expect(page.getByText("Re-imported 1 note")).toBeVisible({
    timeout: 30_000,
  });
  const after = {
    alpha: (await textsOf(page, "Vault/Alpha.excalidraw")).join(" "),
    beta: (await textsOf(page, "Vault/Beta.excalidraw")).join(" "),
  };
  expect(after.alpha).toContain("alpha v2");
  expect((await textsOf(page, "Vault/Beta.excalidraw")).join(" ")).toContain(
    "beta v1",
  );
  expect(errors).toEqual([]);
});

const xs = async (page: Page, path: string) =>
  (await readScene(page, path)).elements
    .filter((e: any) => !e.isDeleted)
    .map((e: any) => Math.round(e.x));

test("hunt: a note the user edited (moved, retyped) is left alone by Re-import unchanged", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  const pick = (a: string, b: string) =>
    page.evaluate(
      ([x, y]) => {
        (window as any).__plugins.backend.folders.sourcePick = {
          name: "Vault",
          files: { "Notes/Alpha.md": x, "Notes/Beta.md": y },
        };
      },
      [a, b],
    );
  await pick("alpha v1\n\nsecond paragraph", "beta v1");
  await clickMainMenuItem(page, "Import Obsidian vault…");
  await expect(row(page, "Vault")).toBeVisible({ timeout: 30_000 });
  await row(page, "Vault/Notes").locator(".vault-tree-item__toggle").click();
  await row(page, "Vault/Notes/Alpha.excalidraw").click();
  const before = await xs(page, "Vault/Notes/Alpha.excalidraw");
  await expect(page.locator(".vault-editor")).toHaveAttribute(
    "data-scene-ready",
    "true",
  );
  // The user moves everything on the page with the arrow keys, like nudging a drawing.
  await page.locator(".vault-editor canvas.interactive").click({
    position: { x: 5, y: 5 },
  });
  await page.keyboard.press("Meta+a");
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Shift+ArrowRight");
  }
  await expect
    .poll(async () => (await xs(page, "Vault/Notes/Alpha.excalidraw"))[0], {
      timeout: 15_000,
    })
    .not.toBe(before[0]);
  await pick("alpha v2", "beta v2");
  await row(page, "Vault/Notes").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Re-import unchanged imported notes here" })
    .click();
  await expect(page.getByText(/Re-imported/)).toBeVisible({ timeout: 30_000 });
  const alpha = (await textsOf(page, "Vault/Notes/Alpha.excalidraw")).join(" ");
  expect(alpha, "the moved note was rewritten from the Markdown").toContain(
    "alpha v1",
  );
  expect(errors).toEqual([]);
});

/** Colours actually painted on the open drawing's canvas inside element `id`'s box. */
const paintedIn = (page: Page, role: string) =>
  page.evaluate((r) => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
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
      .find(
        (x: any) =>
          x.customData?.["plugins.markdown-import"]?.role === r &&
          x.type === "text",
      );
    if (!e) {
      return { error: `no element for ${r}` };
    }
    const c = document.querySelector<HTMLCanvasElement>(
      ".vault-editor canvas.static",
    )!;
    const k = c.width / c.getBoundingClientRect().width;
    const x0 = Math.max(0, Math.round((e.x + st.scrollX) * st.zoom.value * k));
    const y0 = Math.max(0, Math.round((e.y + st.scrollY) * st.zoom.value * k));
    const w = Math.max(1, Math.round(e.width * st.zoom.value * k));
    const h = Math.max(1, Math.round(e.height * st.zoom.value * k));
    const w2 = Math.min(w, c.width - x0);
    const h2 = Math.min(h, c.height - y0);
    if (w2 < 2 || h2 < 2) {
      return { error: "offscreen", x0, y0, w, h, cw: c.width, ch: c.height };
    }
    const d = c.getContext("2d")!.getImageData(x0, y0, w2, h2).data;
    const counts = new Map<string, number>();
    for (let i = 0; i < d.length; i += 4) {
      const kk = `${d[i]},${d[i + 1]},${d[i + 2]}`;
      counts.set(kk, (counts.get(kk) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return { bg: sorted[0][0], ink: sorted.slice(1, 4).map((s) => s[0]) };
  }, role);

const hexOf = (rgb: string) =>
  `#${rgb
    .split(",")
    .map((n) => Number(n).toString(16).padStart(2, "0"))
    .join("")}`;

test("hunt: imported headings are painted in each theme's heading colour, light and dark", async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  await page.evaluate(() => {
    (window as any).__plugins.backend.folders.sourcePick = {
      name: "Vault",
      files: {
        "Head.md": "# Big heading\n\nbody text\n\n## Second heading\n\nmore",
      },
    };
  });
  await clickMainMenuItem(page, "Import Obsidian vault…");
  await expect(row(page, "Vault")).toBeVisible({ timeout: 30_000 });
  await row(page, "Vault/Head.excalidraw").click();
  await expect(page.locator(".vault-editor")).toHaveAttribute(
    "data-scene-ready",
    "true",
  );
  const openSettings = async () => {
    await page
      .getByLabel("Vault file navigator")
      .getByRole("button", { name: "Settings" })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
    return dialog;
  };
  let d = await openSettings();
  const themes = await d
    .getByRole("radio")
    .evaluateAll((els) =>
      els.map((e) =>
        (e.getAttribute("aria-label") || e.textContent || "").trim(),
      ),
    );
  await page.keyboard.press("Escape");
  const bad: string[] = [];
  const report: string[] = [];
  for (const [ti, t] of themes.entries()) {
    if (ti < themes.indexOf("Default")) {
      continue; // scope and canvas-colour radios come first
    }
    for (const mode of ["Light", "Dark"]) {
      d = await openSettings();
      await d.getByRole("radio").nth(ti).click();
      await d
        .getByRole("group", { name: "Mode" })
        .getByRole("button", { name: mode, exact: true })
        .click();
      await page.keyboard.press("Escape");
      await expect(d).toHaveCount(0);
      await page.waitForTimeout(400);
      const tok = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return {
          h1: cs.getPropertyValue("--vault-md-h1").trim(),
          h2: cs.getPropertyValue("--vault-md-h2").trim(),
        };
      });
      for (const [role, want] of [
        ["h1", tok.h1],
        ["h2", tok.h2],
      ] as const) {
        const got = (await paintedIn(page, role)) as any;
        if (got.error) {
          report.push(`${t}/${mode}/${role}: ${JSON.stringify(got)}`);
          continue;
        }
        const inks = got.ink.map(hexOf);
        const near = (a: string, b: string) => {
          const n = (h: string) =>
            [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
          const [x, y] = [n(a), n(b)];
          return Math.max(...x.map((v, i) => Math.abs(v - y[i]))) <= 24;
        };
        const ok = inks.some((h: string) => near(h, want));
        report.push(
          `${t}/${mode}/${role}: want ${want} bg ${hexOf(
            got.bg,
          )} ink ${inks.join(" ")} ${ok ? "ok" : "MISMATCH"}`,
        );
        if (!ok) {
          bad.push(`${t}/${mode}/${role} want ${want} got ${inks.join(" ")}`);
        }
      }
    }
  }
  expect(report.length).toBeGreaterThan(0);
  expect(bad).toEqual([]);
  expect(errors).toEqual([]);
});

const longNote = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `Paragraph number ${i} with some words.`,
  ).join("\n\n");

test("hunt: a note that shrank to one page does not leave its old parts behind after Re-import", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  await page.evaluate(() =>
    (window as any).__updatePreferences({
      pluginSettings: { "markdown-import": { part_elements: 200 } },
    }),
  );
  await page.evaluate((t) => {
    (window as any).__plugins.backend.folders.sourcePick = {
      name: "Vault",
      files: { "Long.md": t },
    };
  }, longNote(700));
  await clickMainMenuItem(page, "Import Obsidian vault…");
  await expect(row(page, "Vault")).toBeVisible({ timeout: 60_000 });
  const names = async () =>
    (await page.locator(".vault-tree-item__name").allInnerTexts()).filter((n) =>
      /^Long/.test(n),
    );
  await expect
    .poll(names, { timeout: 30_000 })
    .toEqual(expect.arrayContaining(["Long", "Long (part 2)"]));
  await page.evaluate(() => {
    (window as any).__plugins.backend.folders.sourcePick = {
      name: "Vault",
      files: { "Long.md": "Now just one line." },
    };
  });
  await row(page, "Vault").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Re-import unchanged imported notes here" })
    .click();
  await expect(page.getByText(/Re-imported/)).toBeVisible({ timeout: 60_000 });
  const after = await names();
  expect((await textsOf(page, "Vault/Long.excalidraw")).join(" ")).toContain(
    "Now just one line.",
  );
  expect(after, "old parts of a note that is now one page").toEqual(["Long"]);
  expect(errors).toEqual([]);
});

const SVG_RED = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#f00"/></svg>`;
const PIC1 = "https://pics.test/one.svg";
const PIC2 = "https://pics.test/two";

const sceneKinds = async (page: Page, path: string) => {
  const s = await readScene(page, path);
  const els = s.elements.filter((e: any) => !e.isDeleted);
  return {
    images: els.filter((e: any) => e.type === "image").length,
    boxes: els.filter((e: any) => e.type === "rectangle" && e.link).length,
    texts: els
      .filter((e: any) => e.type === "text")
      .map((e: any) => e.text as string),
  };
};

const importOne = async (page: Page, files: Record<string, string>) => {
  await page.evaluate((f) => {
    (window as any).__plugins.backend.folders.sourcePick = {
      name: "Vault",
      files: f,
    };
  }, files);
  await clickMainMenuItem(page, "Import Obsidian vault…");
  await expect(row(page, "Vault")).toBeVisible({ timeout: 30_000 });
};

test("hunt: a web picture that failed fills in on Retry, and stays after a reload", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  // One picture answers, one is down (no entry: a network error), one is a page.
  await page.evaluate(
    ([a, svg]) => {
      (window as any).__plugins.backend.network.images = {
        [a]: new TextEncoder().encode(svg),
      };
    },
    [PIC1, SVG_RED] as const,
  );
  await importOne(page, {
    "Pics.md": `before\n\n![one](${PIC1})\n\nmiddle\n\n![two](${PIC2})\n\nafter`,
  });
  await row(page, "Vault/Pics.excalidraw").click();
  await expect(page.getByText(/could not be downloaded/).first()).toBeVisible({
    timeout: 20_000,
  });
  let k = await sceneKinds(page, "Vault/Pics.excalidraw");
  expect(k.images, "the reachable picture is in").toBe(1);
  expect(k.boxes, "the unreachable one is a box").toBe(1);
  // Order on the page: before, picture 1, middle, box 2, after.
  const order = await readScene(page, "Vault/Pics.excalidraw");
  const ys = (pred: (e: any) => boolean) =>
    order.elements
      .filter((e: any) => !e.isDeleted && pred(e))
      .map((e: any) => e.y as number);
  const yBefore = ys((e) => e.text === "before")[0];
  const yMid = ys((e) => e.text === "middle")[0];
  const yAfter = ys((e) => e.text === "after")[0];
  const yImg = ys((e) => e.type === "image")[0];
  const yBox = ys((e) => e.type === "rectangle" && !!e.link)[0];
  expect([yBefore, yImg, yMid, yBox, yAfter]).toEqual(
    [...[yBefore, yImg, yMid, yBox, yAfter]].sort((a, b) => a - b),
  );
  // The server comes back; Retry.
  await page.evaluate(
    ([b, svg]) => {
      (window as any).__plugins.backend.network.images[b] =
        new TextEncoder().encode(svg);
    },
    [PIC2, SVG_RED] as const,
  );
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect
    .poll(
      async () => (await sceneKinds(page, "Vault/Pics.excalidraw")).images,
      {
        timeout: 20_000,
      },
    )
    .toBe(2);
  k = await sceneKinds(page, "Vault/Pics.excalidraw");
  expect(k.boxes).toBe(0);
  expect(k.texts.join("|")).not.toMatch(/could not be downloaded/);
  // Reload: the pictures are in the file, not fetched again.
  const before = await page.evaluate(
    () => (window as any).__plugins.backend.network.fetched.length,
  );
  await page.reload();
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  const after = await page.evaluate(
    () => (window as any).__plugins.backend.network.fetched.length,
  );
  expect(after).toBeLessThanOrEqual(before);
  expect(errors).toEqual([]);
});

test("hunt: strict line breaks and coloured headings settings change the next import and a re-import", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  const NOTE_TXT = "# Title\n\nline one\nline two\n\n## Sub\n\nend";
  await importOne(page, { "Lines.md": NOTE_TXT });
  const scene0 = await readScene(page, "Vault/Lines.excalidraw");
  const t0 = scene0.elements
    .filter((e: any) => e.type === "text")
    .map((e: any) => e.text);
  expect(t0.join("|")).toContain("line one\nline two");
  const h0 = scene0.elements.find(
    (e: any) => e.customData?.["plugins.markdown-import"]?.role === "h1",
  );
  expect(h0, "heading role with colours on").toBeTruthy();

  await page.evaluate(() =>
    (window as any).__updatePreferences({
      pluginSettings: {
        "markdown-import": { strict_line_breaks: true, heading_colors: false },
      },
    }),
  );
  await page.evaluate(
    (f) => {
      (window as any).__plugins.backend.folders.sourcePick = {
        name: "Vault",
        files: f,
      };
    },
    { "Lines.md": NOTE_TXT },
  );
  await row(page, "Vault").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Re-import unchanged imported notes here" })
    .click();
  await expect(page.getByText(/Re-imported 1 note/)).toBeVisible({
    timeout: 30_000,
  });
  const scene1 = await readScene(page, "Vault/Lines.excalidraw");
  const t1 = scene1.elements
    .filter((e: any) => e.type === "text")
    .map((e: any) => e.text);
  expect(t1.join("|")).toContain("line one line two");
  expect(
    scene1.elements.some(
      (e: any) => e.customData?.["plugins.markdown-import"]?.role === "h1",
    ),
    "no heading colour role when coloured headings are off",
  ).toBe(false);
  // The heading is still a heading (bigger than body text).
  const head = scene1.elements.find((e: any) => e.text === "Title");
  const body = scene1.elements.find((e: any) => e.text === "end");
  expect(head.fontSize).toBeGreaterThan(body.fontSize);
  expect(errors).toEqual([]);
});

const liveTexts = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
    let fiber = (el as any)[key];
    while (fiber) {
      const s = fiber.stateNode;
      if (s && s.scene && s.state && typeof s.state.scrollX === "number") {
        return s.scene
          .getNonDeletedElements()
          .filter((e: any) => e.type === "text")
          .map((e: any) => e.text as string);
      }
      fiber = fiber.return;
    }
    throw new Error("editor instance not found");
  });

test("hunt: Re-import of the open note shows the new note on the canvas, and Undo does not blank it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  await importOne(page, { "Open.md": "open v1" });
  await row(page, "Vault/Open.excalidraw").click();
  await expect.poll(() => liveTexts(page)).toContain("open v1");
  await page.evaluate(() => {
    (window as any).__plugins.backend.folders.sourcePick = {
      name: "Vault",
      files: { "Open.md": "open v2" },
    };
  });
  await row(page, "Vault/Open.excalidraw").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Re-import from its Markdown" })
    .click();
  await expect(page.getByText("Re-imported 1 note")).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(() => liveTexts(page), { timeout: 10_000 })
    .toContain("open v2");
  // Undo right after the reload must not wipe or revert the canvas.
  await page
    .locator(".vault-editor canvas.interactive")
    .click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(500);
  expect(await liveTexts(page)).toContain("open v2");
  // The old note is in History (Restore brings it back).
  expect(errors).toEqual([]);
});
