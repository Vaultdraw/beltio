/**
 * The single window-level keydown dispatcher (capture phase). It claims a key
 * only when a bound command's `when` holds and a handler exists; everything
 * else is left untouched so Excalidraw still sees tool letters, Cmd+Z etc.
 */
import { chordFromEvent, isModifierFree } from "./keys";
import { whenHolds } from "./context";

import type {
  Chord,
  CommandContext,
  CommandDefinition,
  CommandHandler,
  Platform,
} from "./types";

export interface DispatcherDeps {
  platform: Platform;
  getKeymap(): ReadonlyMap<Chord, readonly CommandDefinition[]>;
  getContext(): CommandContext;
  getHandler(id: string): CommandHandler | undefined;
}

let pauseCount = 0;

/** Pause dispatching (ref-counted), e.g. while a hotkey is being recorded. */
export function pauseDispatcher(): () => void {
  pauseCount++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      pauseCount--;
    }
  };
}

export const isDispatcherPaused = (): boolean => pauseCount > 0;

const ranListeners = new Set<(id: string) => void>();

/** Observe successful command runs (palette, hotkey, control API). */
export const onCommandRan = (cb: (id: string) => void): (() => void) => {
  ranListeners.add(cb);
  return () => {
    ranListeners.delete(cb);
  };
};

/** Run a handler; a throw or rejection is logged, never propagated. */
export function runHandler(id: string, handler: CommandHandler): void {
  try {
    const result = handler();
    if (ranListeners.size > 0) {
      ranListeners.forEach((cb) => cb(id));
    }
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch((err) =>
        console.error(`Command ${id} failed`, err),
      );
    }
  } catch (err) {
    console.error(`Command ${id} failed`, err);
  }
}

export function installCommandDispatcher(
  win: Window,
  deps: DispatcherDeps,
): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (pauseCount > 0 || e.isComposing || e.keyCode === 229) {
      return;
    }
    const chord = chordFromEvent(e, deps.platform);
    if (!chord) {
      return;
    }
    const candidates = deps.getKeymap().get(chord);
    if (!candidates) {
      return;
    }
    const ctx = deps.getContext();
    if (ctx.textEditing && isModifierFree(chord)) {
      return;
    }
    for (const command of candidates) {
      if (!whenHolds(command.when, ctx)) {
        continue;
      }
      const handler = deps.getHandler(command.id);
      if (!handler) {
        continue;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat || command.repeat) {
        runHandler(command.id, handler);
      }
      return;
    }
  };
  win.addEventListener("keydown", onKeyDown, true);
  return () => win.removeEventListener("keydown", onKeyDown, true);
}
