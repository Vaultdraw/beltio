import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { clickMainMenuItem, openVault, trackErrors } from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Family: every Markdown table imports as a real table (toimprove 109): a grid of cells, a shaded
// header, every cell's text whole (no "…") and inside its cell, grouped so it moves as one, in the
// light and the dark theme. The table shapes (wide, narrow, long words, alignment, pipes, 1 and 30
// columns) are swept in the plugin's unit tests (test/layout/tableGrid.test.ts).

// The owner's "Key terms" table (Learning/Kubernetes/VMs.md), as written.
const KEY_TERMS = [
  "| Term | Meaning |",
  "|---|---|",
  "| Hypervisor | Program that creates VMs, gives them fake hardware and handles what they trap on. On Linux: **KVM** (a module in the host kernel) plus **QEMU** (a normal program that provides fake devices). |",
  "| Host | The real machine and its kernel. |",
  "| Guest | The VM and the kernel inside it. |",
  "| VMX | Intel's virtualization feature (AMD calls it SVM). Adds two CPU modes. |",
  "| VMX root mode | Where the hypervisor and host kernel run. Full control. |",
  "| VMX non-root mode | Where the guest runs. The guest kernel is in **ring 0 of non-root mode**. The CPU watches it. |",
  "| VMCS | Memory block holding guest state and the rules for which events cause a VM exit. |",
  "| VM exit | CPU freezes the guest, saves its state, records the reason, jumps to the hypervisor in root mode. |",
  "| VM entry | CPU resumes the guest at the next instruction. |",
].join("\n");

const ALIGNED = [
  "| Left | Middle | Right |",
  "|:--|:-:|--:|",
  "| a | b | 1 |",
  "| longer cell | `x \\| y` | 1,024 |",
].join("\n");

const NOTE = [
  "# VMs",
  "## Key terms",
  KEY_TERMS,
  "## Aligned",
  ALIGNED,
  "After the tables.",
].join("\n\n");

const SOURCE = {
  name: "Obsidian Notes",
  files: { "Notes/VMs.md": NOTE } as Record<string, string>,
};

type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  textAlign?: string;
  groupIds: string[];
  backgroundColor: string;
};

const sceneElements = (page: Page): Promise<El[]> =>
  page.evaluate(() => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
    let fiber = (el as any)[key];
    while (fiber) {
      const s = fiber.stateNode;
      if (s && s.scene && s.state && typeof s.state.scrollX === "number") {
        return s.scene.getNonDeletedElements().map((e: any) => ({
          id: e.id,
          type: e.type,
          x: e.x,
          y: e.y,
          width: e.width,
          height: e.height,
          text: e.text,
          textAlign: e.textAlign,
          groupIds: [...e.groupIds],
          backgroundColor: e.backgroundColor,
        }));
      }
      fiber = fiber.return;
    }
    throw new Error("editor instance not found");
  });

const row = (page: Page, path: string) =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );

const setMode = async (page: Page, mode: "Light" | "Dark") => {
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
  await dialog
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: mode })
    .click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
};

/** The table whose cells hold `first`: its group's elements. */
const tableOf = (els: El[], first: string) => {
  const cell = els.find((e) => e.type === "text" && e.text === first);
  expect(cell, `a cell reading "${first}"`).toBeTruthy();
  const group = cell!.groupIds[cell!.groupIds.length - 1];
  expect(group, "the table is a group").toBeTruthy();
  return els.filter((e) => e.groupIds.includes(group));
};

for (const mode of ["Light", "Dark"] as const) {
  test(`an imported table is a real table in the ${mode.toLowerCase()} theme`, async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openVault(page, "?plugins=markdown-import");
    await page.waitForFunction(() => (window as any).__pluginsReady === true);
    await setMode(page, mode);
    await seedAndOpen(page, "Start.excalidraw");
    await page.evaluate((src) => {
      (window as any).__plugins.backend.folders.sourcePick = src;
    }, SOURCE);

    await clickMainMenuItem(page, "Import Obsidian vault…");
    await expect(row(page, "Obsidian Notes")).toBeVisible({ timeout: 30_000 });
    await row(page, "Obsidian Notes/Notes")
      .locator(".vault-tree-item__toggle")
      .click();
    await row(page, "Obsidian Notes/Notes/VMs.excalidraw").click();
    await expect
      .poll(
        async () =>
          (await sceneElements(page)).some((e) => e.text === "Hypervisor"),
        { timeout: 20_000 },
      )
      .toBe(true);
    const els = await sceneElements(page);
    if (process.env.IMPORT_TABLE_SHOTS) {
      await page.keyboard.press("Shift+1");
      await page.waitForTimeout(500);
      await page.screenshot({
        path: `${process.env.IMPORT_TABLE_SHOTS}/table-${mode}.png`,
      });
    }

    // Key terms: every cell whole, nothing cut, nothing outside its cell.
    const table = tableOf(els, "Term");
    const texts = table.filter((e) => e.type === "text");
    expect(texts.map((t) => t.text).join("")).not.toMatch(/[…│─┼]/);
    const words = (s: string) => s.replace(/\*\*/g, "").replace(/\s+/g, "");
    expect(words(texts.map((t) => t.text).join(""))).toBe(
      words(
        KEY_TERMS.split("\n")
          .filter((l) => !l.startsWith("|---"))
          .join("")
          .replace(/\|/g, ""),
      ),
    );
    const frame = table.find(
      (e) => e.type === "rectangle" && e.backgroundColor === "transparent",
    )!;
    expect(frame, "the table's outer border").toBeTruthy();
    for (const t of texts) {
      expect(t.x).toBeGreaterThanOrEqual(frame.x);
      expect(t.y).toBeGreaterThanOrEqual(frame.y);
      expect(t.x + t.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
      expect(t.y + t.height).toBeLessThanOrEqual(frame.y + frame.height + 0.5);
    }
    // Cells never overlap: each column's texts sit between two grid lines.
    const xs = [
      frame.x,
      ...table
        .filter((e) => e.type === "line" && e.width === 0)
        .map((e) => e.x),
      frame.x + frame.width,
    ].sort((a, b) => a - b);
    for (const t of texts) {
      const left = xs.filter((x) => x <= t.x + 0.5).pop()!;
      const right = xs.find((x) => x > t.x + 0.5)!;
      expect(t.x + t.width).toBeLessThanOrEqual(right + 0.5);
      expect(t.x).toBeGreaterThanOrEqual(left);
    }
    // A shaded header row.
    expect(
      table.some(
        (e) => e.type === "rectangle" && e.backgroundColor !== "transparent",
      ),
    ).toBe(true);

    // Alignment from the Markdown: left, center, right.
    const aligned = tableOf(els, "Left").filter((e) => e.type === "text");
    const alignOf = (s: string) => aligned.find((e) => e.text === s)?.textAlign;
    expect([alignOf("a"), alignOf("b"), alignOf("1")]).toEqual([
      "left",
      "center",
      "right",
    ]);
    expect(aligned.some((e) => e.text === "x | y")).toBe(true);

    expect(errors).toEqual([]);
  });
}
