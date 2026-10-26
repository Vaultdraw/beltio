/**
 * Extension bisect actions and their palette commands. Start is offered when
 * no bisect runs; the answers and Stop only during one. A finished bisect
 * shows its result in the banner until the user restarts.
 */
import { registerCommandHandlers } from "../commands/handlerRegistry";
import { toastStore } from "../toasts/toastStore";
import {
  getPreferences,
  updatePreferences,
  type VaultPreferences,
} from "../vault/preferences";
import { getSafeStart, subscribeSafeStart } from "../safeStart/state";
import { flushSettings } from "../vault/settingsSync";
import { isPluginId } from "../vault/pluginSettingsTable";

import {
  answerBisect,
  startBisect,
  type BisectAnswer,
  type BisectNext,
} from "./bisect";
import { BISECT_COMMAND_IDS } from "./bisectCommandDefs";
import {
  getBisect,
  saveBisectAndRestart,
  subscribeBisect,
} from "./bisectState";
import {
  BUILTIN_EXTENSIONS,
  EXTENSION_FIELDS,
  isExtensionId,
} from "./registry";

/** A built-in extension's title, or a plugin's id. */
export const extensionLabel = (id: string): string =>
  BUILTIN_EXTENSIONS.find((e) => e.id === id)?.title ?? id;

// ---- the finished result, shown until the restart ------------------------
type Result = Exclude<BisectNext, { kind: "continue" }>;
let result: Result | null = null;
const resultListeners = new Set<() => void>();
const setResult = (r: Result | null) => {
  result = r;
  resultListeners.forEach((l) => l());
};
export const getBisectResult = (): Result | null => result;
export function subscribeBisectResult(cb: () => void): () => void {
  resultListeners.add(cb);
  return () => {
    resultListeners.delete(cb);
  };
}

const report = (e: unknown) =>
  toastStore.push({
    message: `Could not restart: ${e instanceof Error ? e.message : String(e)}`,
    kind: "error",
  });

/** A plugin as the host lists it: what decides whether it runs. */
export interface RunnablePlugin {
  id: string;
  compatible: boolean;
  hostDisabled: string | null;
  review: { state: string };
}

/**
 * What runs now and can be bisected: built-in extensions that are on, and
 * enabled plugins that are installed, not disabled by the host and not
 * waiting for a permission review.
 */
export function bisectCandidates(
  win: Window | null | undefined,
  plugins: readonly RunnablePlugin[],
): string[] {
  const prefs = getPreferences(win);
  const runnable = new Set(
    plugins
      .filter(
        (p) =>
          p.compatible &&
          p.hostDisabled === null &&
          p.review.state !== "review",
      )
      .map((p) => p.id),
  );
  return [
    ...BUILTIN_EXTENSIONS.filter((e) => prefs[EXTENSION_FIELDS[e.id]]).map(
      (e) => e.id as string,
    ),
    ...prefs.pluginsEnabled.filter((id) => isPluginId(id) && runnable.has(id)),
  ];
}

/** Bisect needs every extension running as configured: not in any safe start. */
export const canBisect = (): boolean => getSafeStart() === null;

export async function beginBisect(win?: Window | null): Promise<void> {
  if (!canBisect()) {
    return;
  }
  // Loaded on use: the plugin host's list of what is installed.
  const { currentList } = await import("../plugins/host/pluginsState");
  const state = startBisect(bisectCandidates(win, currentList().plugins));
  if (!state) {
    toastStore.push({ message: "No extension is on: nothing to bisect." });
    return;
  }
  void saveBisectAndRestart(state).catch(report);
}

export function answer(a: BisectAnswer): void {
  const state = getBisect();
  // In a safe start everything is off: an answer would judge the wrong half.
  if (!state || !canBisect()) {
    return;
  }
  const next = answerBisect(state, a);
  if (next.kind === "continue") {
    void saveBisectAndRestart(next.state).catch(report);
  } else {
    setResult(next);
  }
}

/** End the bisect and restart with everything as configured. */
export function stopBisect(): void {
  void saveBisectAndRestart(null).catch(report);
}

/** Turn the culprit off in config, then end the bisect and restart. */
export async function turnOffAndStop(
  id: string,
  win?: Window | null,
): Promise<void> {
  if (isExtensionId(id)) {
    updatePreferences(
      { [EXTENSION_FIELDS[id]]: false } as Partial<VaultPreferences>,
      win,
    );
  } else {
    updatePreferences(
      {
        pluginsEnabled: getPreferences(win).pluginsEnabled.filter(
          (p) => p !== id,
        ),
      },
      win,
    );
  }
  // The config write must land before the app quits.
  await flushSettings().catch(() => undefined);
  stopBisect();
}

/** Binds the commands that apply now; follows the bisect state. */
export function registerBisectCommands(win?: Window | null): () => void {
  let off: (() => void) | null = null;
  const sync = () => {
    off?.();
    const running = getBisect() !== null;
    off = running
      ? registerCommandHandlers({
          ...(canBisect()
            ? {
                [BISECT_COMMAND_IDS.still]: () => answer("still"),
                [BISECT_COMMAND_IDS.gone]: () => answer("gone"),
              }
            : {}),
          [BISECT_COMMAND_IDS.stop]: stopBisect,
        })
      : canBisect()
      ? registerCommandHandlers({
          [BISECT_COMMAND_IDS.start]: () => void beginBisect(win),
        })
      : null;
  };
  sync();
  const unsubscribe = subscribeBisect(sync);
  const unsubscribeSafe = subscribeSafeStart(sync);
  return () => {
    unsubscribe();
    unsubscribeSafe();
    off?.();
    off = null;
  };
}
