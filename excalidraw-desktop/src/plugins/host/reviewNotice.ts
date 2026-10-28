/**
 * One startup toast when enabled plugins are held back until the user reviews them, so their
 * commands and keys do not vanish without a word (Obsidian and VS Code say so as well).
 */
import { getAppCommandRunner } from "../../commands/appRunner";
import { toastStore } from "../../toasts/toastStore";

import { PLUGIN_UI_COMMAND_IDS } from "../ui/pluginCommands";

import { needsReview } from "./permissions";

import type { PluginInfo, PluginsList } from "./types";

let shown = false;

/** Plugins that are enabled and waiting for review (the ones that are otherwise off). */
export const pluginsWaitingForReview = (
  infos: readonly PluginInfo[],
  enabledIds: readonly string[],
): PluginInfo[] => {
  const enabled = new Set(enabledIds);
  return infos.filter(
    (i) =>
      enabled.has(i.id) && i.compatible && !i.hostDisabled && needsReview(i),
  );
};

/** Folders refused because they reuse an official plugin id. */
export const refusedForOfficialId = (
  errors: readonly { dir: string; message: string }[],
): string[] =>
  errors
    .filter((e) => /official plugin id/i.test(e.message))
    .map((e) => e.dir.split("/").pop() ?? e.dir);

const nameList = (names: readonly string[]): string =>
  names.length <= 3
    ? names.join(", ")
    : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;

/**
 * Once per launch: names the plugins that are off until reviewed, the folders refused for reusing
 * an official id, and a damaged consent file that was moved aside. Returns true when it pushed it.
 */
export function noticePluginsWaitingForReview(
  list: Pick<PluginsList, "plugins" | "errors" | "consentReset">,
  enabledIds: readonly string[],
): boolean {
  if (shown) {
    return false;
  }
  const waiting = pluginsWaitingForReview(list.plugins, enabledIds);
  const refused = refusedForOfficialId(list.errors);
  const reset = list.consentReset === true;
  if (waiting.length === 0 && refused.length === 0 && !reset) {
    return false;
  }
  shown = true;
  const parts: string[] = [];
  if (reset) {
    parts.push(
      "The plugin confirmations file was damaged and was moved aside (plugin-consent.json.corrupt), so plugins ask again",
    );
  }
  if (waiting.length > 0) {
    parts.push(
      `${waiting.length} plugin${
        waiting.length === 1 ? " is" : "s are"
      } off until you review ${
        waiting.length === 1 ? "it" : "them"
      }: ${nameList(waiting.map((i) => i.name))}`,
    );
  }
  if (refused.length > 0) {
    parts.push(
      `${refused.length} plugin folder${
        refused.length === 1 ? " was" : "s were"
      } refused for reusing an official plugin id: ${nameList(refused)}`,
    );
  }
  toastStore.push({
    message: `${parts.join(". ")}.`,
    durationMs: 30_000,
    action: {
      label: "Review",
      run: () =>
        void getAppCommandRunner()?.(PLUGIN_UI_COMMAND_IDS.openSettings),
    },
  });
  return true;
}

/** Test hook. */
export const resetReviewNotice = (): void => {
  shown = false;
};
