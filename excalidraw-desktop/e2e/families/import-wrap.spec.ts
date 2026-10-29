import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import {
  clickMainMenuItem,
  openVault,
  readScene,
  screenshot,
  SHOTS,
  trackErrors,
} from "../helpers";
import { runPaletteCommand } from "../historyHelpers";
import { seedAndOpen, setupOf } from "../pageHelpers";

// Family: no imported text is clipped (toimprove #111, #113). A VMs-like note goes through
// "Import Obsidian vault…" in light and in dark: every line of every text is narrower than its
// element, measured with the font the editor draws it in. Then a note imported by an older version
// (Excalifont, lines wrapped for Excalifont) is updated to a wider font, the owner's case: its
// text is re-wrapped and nothing is clipped or overlaps.

const MARK = "plugins.markdown-import";

const LONG =
  "A kernel assumes it is the only program in ring 0 and owns the MMU, disk, network card and timer. Two kernels cannot both own the same hardware. A VM lets a second kernel (the guest) run while it still believes it owns a computer.";

const NOTE = [
  "# This folder is about understanding of Virtual Machines",
  "Notes from the Q&A session, x86 and Linux terms only.",
  "## Why VMs need special CPU help",
  LONG,
  "### One disk write, step by step",
  `1. Guest program calls write() (normal syscall into the guest kernel), ${LONG}`,
  "2. Host kernel writes it to the real SSD.",
  `> ${LONG}`,
  "```\nuname -sr   # host kernel, then the guest kernel inside the VM, a long line of code\n```",
].join("\n\n");

/** Family names the editor draws each font id with (packages/common FONT_FAMILY). */
const FONT_NAMES: Record<number, string> = {
  1: "Virgil",
  2: "Helvetica",
  3: "Cascadia",
  5: "Excalifont",
  6: "Nunito",
  8: "Comic Shanns",
  9: "Liberation Sans",
};

type Clip = { text: string; line: string; width: number; lineWidth: number };

/** Every line wider than its text element, measured with the face the editor draws. */
const clippedLines = (page: Page, elements: unknown[]) =>
  page.evaluate(
    async ([els, names]) => {
      const out: Clip[] = [];
      const ctx = document.createElement("canvas").getContext("2d")!;
      for (const e of els as any[]) {
        if (e.type !== "text" || e.isDeleted || e.containerId) {
          continue;
        }
        const font = `${e.fontSize}px ${(names as any)[e.fontFamily]}`;
        await document.fonts.load(font, e.text);
        ctx.font = font;
        for (const line of String(e.text).split("\n")) {
          const lineWidth = ctx.measureText(line).width;
          if (lineWidth > e.width + 0.5) {
            out.push({
              text: e.text.slice(0, 40),
              line,
              width: e.width,
              lineWidth,
            });
          }
        }
      }
      return out;
    },
    [elements, FONT_NAMES] as const,
  );

const setMode = async (page: Page, mode: "Light" | "Dark") => {
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
  await dialog
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: mode })
    .click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
};

const row = (page: Page, path: string) =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );

for (const mode of ["Light", "Dark"] as const) {
  test(`an imported note has no clipped text (${mode})`, async ({
    page,
  }, info) => {
    const errors = trackErrors(page);
    await openVault(page, "?plugins=markdown-import");
    await page.waitForFunction(() => (window as any).__pluginsReady === true);
    await setMode(page, mode);
    await seedAndOpen(page, "Start.excalidraw");
    await page.evaluate((note) => {
      (window as any).__plugins.backend.folders.sourcePick = {
        name: "Learning",
        files: { "Kubernetes/VMs.md": note },
      };
    }, NOTE);

    await clickMainMenuItem(page, "Import Obsidian vault…");
    await expect(row(page, "Learning")).toBeVisible({ timeout: 30_000 });
    await row(page, "Learning/Kubernetes")
      .locator(".vault-tree-item__toggle")
      .click();
    await row(page, "Learning/Kubernetes/VMs.excalidraw").click();

    const scene = await readScene(page, "Learning/Kubernetes/VMs.excalidraw");
    expect(await clippedLines(page, scene.elements)).toEqual([]);

    await screenshot(page, {
      path: `${SHOTS}/${
        info.project.name
      }-import-styling-${mode.toLowerCase()}.png`,
    });
    expect(errors).toEqual([]);
  });
}

test("Update imported notes re-wraps text that took a wider font", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await setMode(page, "Dark");
  // Lines wrapped for Excalifont at 682 px, as the old import wrote them.
  const elements = await page.evaluate(
    async ([long, mark]) => {
      await document.fonts.load("16px Excalifont", long);
      await document.fonts.load("28.5px Excalifont", long);
      const ctx = document.createElement("canvas").getContext("2d")!;
      const wrap = (t: string, size: number) => {
        ctx.font = `${size}px Excalifont`;
        const out: string[] = [];
        let line = "";
        for (const w of t.split(" ")) {
          const next = line ? `${line} ${w}` : w;
          if (ctx.measureText(next).width > 682 && line) {
            out.push(line);
            line = w;
          } else {
            line = next;
          }
        }
        out.push(line);
        return out;
      };
      let y = 56;
      let n = 0;
      const text = (t: string, size: number, extra: object = {}) => {
        const lines = wrap(t, size);
        const el = {
          id: `t${n++}`,
          type: "text",
          x: 56,
          y,
          width: 682,
          height: lines.length * size * 1.25,
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
          seed: 1,
          version: 1,
          versionNonce: 0,
          isDeleted: false,
          boundElements: null,
          updated: 1,
          link: null,
          locked: false,
          text: lines.join("\n"),
          originalText: lines.join("\n"),
          fontSize: size,
          fontFamily: 5,
          textAlign: "left",
          verticalAlign: "top",
          containerId: null,
          autoResize: false,
          lineHeight: 1.25,
          ...extra,
        };
        y += el.height + 12;
        return el;
      };
      return [
        text("Why VMs need special CPU help", 28.5, {
          customData: { [mark]: { heading: 1 } },
        }),
        text(long, 16),
        text(long, 16),
        text("Key terms", 28.5, { customData: { [mark]: { heading: 1 } } }),
      ];
    },
    [LONG, MARK] as const,
  );
  await page.evaluate(
    ([els, setup]) => {
      const repo = (window as any).__vaultRepo;
      repo.seedDrawing(
        "Imported/CPU.excalidraw",
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          elements: els,
          appState: { pageSetup: setup },
          files: {},
        }),
      );
      repo.emit({ handle: repo.handle, paths: [], rescan: true });
    },
    [elements, setupOf({ paperTheme: "normal" })] as const,
  );
  // The drawing font the update gives the note: Cascadia, wider than Excalifont.
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Drawing", exact: true }).click();
  await dialog.getByLabel("Default font family").selectOption("3");
  await page.keyboard.press("Escape");

  await runPaletteCommand(
    page,
    "Markdown: Update imported notes to my theme and font",
    "Update imported notes",
  );
  await expect(page.getByText(/Updated 1 imported note/)).toBeVisible({
    timeout: 20_000,
  });
  const scene = await readScene(page, "Imported/CPU.excalidraw");
  const texts = scene.elements.filter((e: any) => e.type === "text");
  for (const t of texts) {
    expect(t.fontFamily).toBe(3);
  }
  expect(await clippedLines(page, scene.elements)).toEqual([]);
  // Nothing overlaps after the reflow.
  const sorted = [...texts].sort((a: any, b: any) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    expect(sorted[i].y).toBeGreaterThanOrEqual(
      sorted[i - 1].y + sorted[i - 1].height - 0.01,
    );
  }
  expect(errors).toEqual([]);
});
