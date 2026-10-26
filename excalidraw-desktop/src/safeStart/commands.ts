/**
 * Palette commands for the safe start, and the handler for a second launch that asks for one.
 * `app.restartSafe` is offered in a normal start (and in plugin safe mode); `app.restartNormally`
 * only in a safe start. The offer follows the state, so it changes without a reload.
 */
import { registerCommandHandlers } from "../commands/handlerRegistry";
import { registerCommands } from "../commands/registry";
import { toastStore } from "../toasts/toastStore";

import { restartNormally, restartSafeStart } from "./backend";
import { isCoreSafeStart, subscribeSafeStart } from "./state";

import type { CommandDefinition } from "../commands/types";

/** Event the app sends when `vaultdraw launch --safe` reaches a running app. */
export const SAFE_REQUESTED_EVENT = "launch-safe-requested";

const def = (id: string, title: string): CommandDefinition => ({
  id,
  title,
  category: "App",
  keys: { default: [] },
  palette: true,
});

const report = (e: unknown) =>
  toastStore.push({
    message: `Could not restart: ${e instanceof Error ? e.message : String(e)}`,
    kind: "error",
  });

const guarded = (fn: () => Promise<unknown>) => () => {
  void fn().catch(report);
};

/** The one command offered now: restart into safe start, or back to normal. */
export function offeredCommand(): [CommandDefinition, () => void] {
  return isCoreSafeStart()
    ? [def("app.restartNormally", "Restart normally"), guarded(restartNormally)]
    : [
        def("app.restartSafe", "Restart in safe start (core only)"),
        guarded(restartSafeStart),
      ];
}

/** Registers the commands and keeps them in step with the safe-start state. */
export function registerSafeStartCommands(): () => void {
  let off: (() => void) | null = null;
  const sync = () => {
    off?.();
    const [command, run] = offeredCommand();
    const offCommand = registerCommands([command]);
    const offHandler = registerCommandHandlers({ [command.id]: run });
    off = () => {
      offHandler();
      offCommand();
    };
  };
  sync();
  const unsubscribe = subscribeSafeStart(sync);
  return () => {
    unsubscribe();
    off?.();
    off = null;
  };
}

/** A second launch asked for a safe start: ask first, because the restart closes the window. */
export function onSafeStartRequested(): void {
  if (isCoreSafeStart()) {
    toastStore.push({ message: "Vaultdraw is already in safe start." });
    return;
  }
  toastStore.push({
    message:
      "A new launch asked for a safe start. Open drawings are saved first.",
    action: { label: "Restart in safe start", run: guarded(restartSafeStart) },
    durationMs: 30000,
  });
}

type ListenFn = (
  event: string,
  handler: () => void,
) => Promise<() => void> | (() => void);

const tauriListen: ListenFn = async (event, handler) =>
  (await import("@tauri-apps/api/event")).listen(event, handler);

/** Listens for `launch-safe-requested`; resolves to the unlisten function (a no-op outside Tauri). */
export async function listenSafeStartRequests(
  listen: ListenFn = tauriListen,
): Promise<() => void> {
  try {
    return await listen(SAFE_REQUESTED_EVENT, onSafeStartRequested);
  } catch {
    return () => {};
  }
}
