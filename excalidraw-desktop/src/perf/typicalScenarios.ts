/**
 * Opt-in "typical vault" mode: 50 drawings in a few folders and one 300-element
 * drawing with 2 images (perf/typical.config.json, perf/lib/extraVaults.mjs).
 * Measures open of the big drawing, a save and a short pan; cold start and the
 * idle footprint per process come from the runner. For a fair comparison with
 * other note apps on a normal vault.
 */
import typicalConfig from "../../perf/typical.config.json";

import { runAblation } from "./ablateScenarios";
import { runEverydayScenarios } from "./everydayScenarios";
import { expandFolder, openVaultFolder } from "./perfKit";
import { countLong } from "./perfStats";

import type { PerfKit } from "./perfKit";

export type TypicalConfig = typeof typicalConfig;

const top = (path: string) => path.split("/")[0];
const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");

export async function runTypicalScenarios(
  kit: PerfKit,
  config: TypicalConfig = typicalConfig,
): Promise<void> {
  const { row, push, samples, info, scenario, openByRow, sleep } = kit;
  const { target } = config;
  const folders = Object.keys(config.folders);

  await scenario("typical-vault-open", async () => {
    push(
      "typical.vaultOpenToTree",
      await openVaultFolder(kit, () =>
        [...folders, top(target.path)].every((path) => Boolean(row(path))),
      ),
    );
    info.typicalRootRows = kit
      .treeRows()
      .filter((item) => !(item.dataset.treePath ?? "").includes("/")).length;
  });

  if (kit.modes.everyday) {
    // The owner's typical use replaces the big-drawing open, save and pan.
    await runEverydayScenarios(kit);
    return;
  }

  await scenario("typical-open", async () => {
    const dir = parentOf(target.path);
    await expandFolder(kit, dir);
    const siblings = kit
      .childRows(dir)
      .map((el) => el.dataset.treePath ?? "")
      .filter((path) => path.endsWith(".excalidraw") && path !== target.path)
      .sort();
    // A few ordinary opens first: the app is in normal use when the big drawing is opened.
    for (const path of siblings.slice(0, config.warmOpens)) {
      await openByRow(path);
      await sleep(kit.modes.warmGapMs ?? 300);
    }
    push("typical.open.300", (await openByRow(target.path)).total);
    await sleep(500);
  });

  if (kit.modes.ablate) {
    // Memory probe replaces save/pan to keep the run short.
    await runAblation(kit);
    return;
  }

  await scenario("typical-save", async () => {
    kit.wrapWrites();
    kit.resetWrites();
    for (let i = 0; i < 3; i++) {
      await kit.saveOnce(target.path, "typical.save.300");
    }
  });

  await scenario("typical-pan", async () => {
    const canvas = kit.interactiveCanvas();
    if (!canvas) {
      throw new Error("No interactive canvas for pan");
    }
    await sleep(500);
    const pan = await kit.wheelPass(canvas, config.panMs, (phase) => ({
      deltaX: 0,
      deltaY: phase === 0 ? 40 : -40,
      shiftKey: true,
    }));
    samples["typical.pan.frame"] = pan.intervals;
    push("typical.pan.longFrames", countLong(pan.intervals));
    info.typicalPanVerified = pan.verified;
  });
}
