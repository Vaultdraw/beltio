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
import { isCoreSafeStart } from "../safeStart/state";

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

/** What is on now and can be bisected: built-in extensions and enabled plugins. */
export function bisectCandidates(win?: Window | null): string[] {
  const prefs = getPreferences(win);
  return [
    ...BUILTIN_EXTENSIONS.filter((e) => prefs[EXTENSION_FIELDS[e.id]]).map(
      (e) => e.id as string,
    ),
    ...prefs.pluginsEnabled,
  ];
}

export function beginBisect(win?: Window | null): void {
  const state = startBisect(bisectCandidates(win));
  if (!state) {
    toastStore.push({ message: "No extension is on: nothing to bisect." });
    return;
  }
  void saveBisectAndRestart(state).catch(report);
}

export function answer(a: BisectAnswer): void {
  const state = getBisect();
  if (!state) {
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
export function turnOffAndStop(id: string, win?: Window | null): void {
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
  stopBisect();
}

/** Binds the commands that apply now; follows the bisect state. */
export function registerBisectCommands(win?: Window | null): () => void {
  let off: (() => void) | null = null;
  const sync = () => {
    off?.();
    off = getBisect()
      ? registerCommandHandlers({
          [BISECT_COMMAND_IDS.still]: () => answer("still"),
          [BISECT_COMMAND_IDS.gone]: () => answer("gone"),
          [BISECT_COMMAND_IDS.stop]: stopBisect,
        })
      : isCoreSafeStart()
      ? null
      : registerCommandHandlers({
          [BISECT_COMMAND_IDS.start]: () => beginBisect(win),
        });
  };
  sync();
  const unsubscribe = subscribeBisect(sync);
  return () => {
    unsubscribe();
    off?.();
    off = null;
  };
}
