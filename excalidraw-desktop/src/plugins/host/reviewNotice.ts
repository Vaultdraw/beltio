/**
 * One startup toast when enabled plugins are held back until the user reviews them, so their
 * commands and keys do not vanish without a word (Obsidian and VS Code say so as well).
 */
import { getAppCommandRunner } from "../../commands/appRunner";
import { toastStore } from "../../toasts/toastStore";

import { PLUGIN_UI_COMMAND_IDS } from "../ui/pluginCommands";

import { needsReview } from "./permissions";

import type { PluginInfo } from "./types";

let shown = false;

/** Plugins that are enabled and waiting for review (the ones that are otherwise off). */
export const pluginsWaitingForReview = (
  infos: readonly PluginInfo[],
  enabledIds: readonly string[],
): PluginInfo[] => {
  const enabled = new Set(enabledIds);
  return infos.filter(
    (i) => enabled.has(i.id) && i.compatible && !i.hostDisabled && needsReview(i),
  );
};

/** Once per launch; returns true when it pushed the toast. */
export function noticePluginsWaitingForReview(
  infos: readonly PluginInfo[],
  enabledIds: readonly string[],
): boolean {
  if (shown) {
    return false;
  }
  const waiting = pluginsWaitingForReview(infos, enabledIds);
  if (waiting.length === 0) {
    return false;
  }
  shown = true;
  const names = waiting.map((i) => i.name);
  const listed =
    names.length <= 3
      ? names.join(", ")
      : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  toastStore.push({
    message: `${waiting.length} plugin${
      waiting.length === 1 ? " is" : "s are"
    } off until you review ${waiting.length === 1 ? "it" : "them"}: ${listed}.`,
    durationMs: 30_000,
    action: {
      label: "Review",
      run: () => void getAppCommandRunner()?.(PLUGIN_UI_COMMAND_IDS.openSettings),
    },
  });
  return true;
}

/** Test hook. */
export const resetReviewNotice = (): void => {
  shown = false;
};
