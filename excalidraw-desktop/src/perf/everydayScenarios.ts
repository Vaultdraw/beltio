/**
 * Opt-in "everyday" mode (perf/run.mjs --everyday): the owner's typical use
 * (2026-10-27): 2–3 drawings open, each about 12 shapes and 100 lines of text.
 * Opens the three note drawings in tabs, switches back, types a short note,
 * saves and pans; the runner adds cold start and the idle footprint.
 */
import { countLong } from "./perfStats";

import type { PerfKit } from "./perfKit";

/** Same paths as perf/lib/extraVaults.mjs EVERYDAY_NOTES. */
export const EVERYDAY_NOTES = [
  "Notes/everyday-a.excalidraw",
  "Notes/everyday-b.excalidraw",
  "Notes/everyday-c.excalidraw",
];

const GAP_MS = 800;

export async function runEverydayScenarios(kit: PerfKit): Promise<void> {
  const {
    root,
    doc,
    win,
    row,
    push,
    samples,
    info,
    scenario,
    openByRow,
    sleep,
    now,
    waitUntil,
    afterPaint,
    editorId,
    key,
  } = kit;

  const waitEditor = (path: string) =>
    waitUntil(
      `editor for ${path}`,
      () =>
        Boolean(editorId()?.endsWith(`:${path}`)) &&
        !root.querySelector(".vault-editor-container--busy"),
      15_000,
    );

  /** Cmd+click on the tree row: opens the drawing in a new tab. */
  const openInNewTab = async (path: string) => {
    const target = row(path);
    if (!target) {
      throw new Error(`Tree row not found: ${path}`);
    }
    const t0 = now();
    target.dispatchEvent(
      new win.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        metaKey: true,
      }),
    );
    await waitEditor(path);
    await afterPaint();
    await afterPaint();
    return now() - t0;
  };

  const activateTab = async (path: string) => {
    const tab = doc.querySelector<HTMLElement>(
      `[data-testid="vault-tab"][data-path="${CSS.escape(path)}"]`,
    );
    if (!tab) {
      throw new Error(`Tab not found: ${path}`);
    }
    const t0 = now();
    tab.click();
    await waitEditor(path);
    await afterPaint();
    await afterPaint();
    return now() - t0;
  };

  const [first, second, third] = EVERYDAY_NOTES;

  await scenario("everyday-open", async () => {
    await kit.revealRow("Notes");
    await kit.waitUntil("Notes folder", () => Boolean(row("Notes")));
    if (row("Notes")?.getAttribute("aria-expanded") !== "true") {
      kit.click(row("Notes"), "Notes");
    }
    await waitUntil("Notes children", () => Boolean(row(first)));
    push("everyday.open", (await openByRow(first)).total);
    await sleep(GAP_MS);
    push("everyday.open", await openInNewTab(second));
    await sleep(GAP_MS);
    push("everyday.open", await openInNewTab(third));
    await sleep(GAP_MS);
    info.everydayTabs = doc.querySelectorAll(
      '[data-testid="vault-tab"]',
    ).length;
  });

  await scenario("everyday-switch", async () => {
    push("everyday.switch", await activateTab(first));
    await sleep(GAP_MS);
    push("everyday.switch", await activateTab(second));
    await sleep(GAP_MS);
  });

  await scenario("everyday-type", async () => {
    const canvas = kit.interactiveCanvas();
    if (!canvas) {
      throw new Error("No interactive canvas for typing");
    }
    key(doc, "Escape");
    await afterPaint();
    const bounds = canvas.getBoundingClientRect();
    const x = bounds.left + Math.min(980, bounds.width - 30);
    const y = bounds.top + Math.min(650, bounds.height - 30);
    canvas.dispatchEvent(
      new win.MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      }),
    );
    const editor = () =>
      doc.querySelector<HTMLTextAreaElement>("textarea.excalidraw-wysiwyg");
    const opened = await waitUntil("text editor", () => Boolean(editor()), 3000)
      .then(() => true)
      .catch(() => false);
    info.everydayTyped = opened;
    if (!opened) {
      return;
    }
    const text = "call the team about the q3 plan ";
    for (const char of text) {
      const current = editor();
      if (!current) {
        break;
      }
      current.value += char;
      current.dispatchEvent(
        new win.InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: char,
        }),
      );
      await afterPaint();
      await sleep(40);
    }
    key(editor() ?? doc, "Escape");
    await afterPaint();
    await sleep(GAP_MS);
  });

  await scenario("everyday-save", async () => {
    kit.wrapWrites();
    kit.resetWrites();
    await kit.saveOnce(second, "everyday.save");
  });

  await scenario("everyday-pan", async () => {
    const canvas = kit.interactiveCanvas();
    if (!canvas) {
      throw new Error("No interactive canvas for pan");
    }
    await sleep(500);
    const pan = await kit.wheelPass(canvas, 1000, (phase) => ({
      deltaX: 0,
      deltaY: phase === 0 ? 40 : -40,
      shiftKey: true,
    }));
    samples["everyday.pan.frame"] = pan.intervals;
    push("everyday.pan.longFrames", countLong(pan.intervals));
    info.everydayPanVerified = pan.verified;
  });
}
