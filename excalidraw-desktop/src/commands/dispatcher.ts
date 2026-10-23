/**
 * The single window-level keydown dispatcher (capture phase). It claims a key
 * only when a bound command's `when` holds and a handler exists; everything
 * else is left untouched so Excalidraw still sees tool letters, Cmd+Z etc.
 */
import { chordFromEvent, isModifierFree } from "./keys";
import { whenHolds } from "./context";
import { DEFAULT_KEY_OPTIONS, canStartInText } from "./keySequence";
import { clearPendingKeys, setPendingKeys } from "./pendingKeys";

import type { KeyOptions } from "./keySequence";
import type { SeqNode, SeqRoot } from "./keyTrie";
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
  /** Sequence trie; absent or null = no sequences (the default). */
  getSeqRoot?(): SeqRoot;
  /** Timeouts; absent = defaults. */
  getOptions?(): KeyOptions;
}

/** Listeners that exist only while a sequence is pending. */
const CANCEL_EVENTS = ["blur", "pointerdown", "compositionstart", "focusin"];

let cancelActive: (() => void) | null = null;

/** Drop a half-typed sequence (config reload, trie rebuild); no-op when idle. */
export const cancelPendingSequence = (): void => cancelActive?.();

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
  // Pending sequence state; all null/empty while idle.
  let node: SeqNode | null = null;
  let path: Chord[] = [];
  let ambiguityTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const runnable = (
    commands: readonly CommandDefinition[] | null | undefined,
    ctx: CommandContext,
  ): { id: string; handler: CommandHandler } | null => {
    for (const command of commands ?? []) {
      if (!whenHolds(command.when, ctx)) {
        continue;
      }
      const handler = deps.getHandler(command.id);
      if (handler) {
        return { id: command.id, handler };
      }
    }
    return null;
  };

  /** Some command below `n` could run now (its `when` holds, it has a handler). */
  const hasLivePath = (n: SeqNode, ctx: CommandContext): boolean => {
    if (runnable(n.commands, ctx)) {
      return true;
    }
    if (n.next) {
      for (const child of n.next.values()) {
        if (hasLivePath(child, ctx)) {
          return true;
        }
      }
    }
    return false;
  };

  const claim = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  /** Window blur only (element blurs also reach a capture listener on window). */
  const onCancelEvent = (ev: Event) => {
    if (ev.type !== "blur" || ev.target === ev.currentTarget) {
      cancel();
    }
  };

  const cancel = () => {
    if (!node) {
      return;
    }
    node = null;
    path = [];
    clearTimeout(ambiguityTimer);
    clearTimeout(idleTimer);
    ambiguityTimer = idleTimer = undefined;
    for (const type of CANCEL_EVENTS) {
      win.removeEventListener(type, onCancelEvent, true);
    }
    if (cancelActive === cancel) {
      cancelActive = null;
    }
    clearPendingKeys();
  };

  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    const ms = (deps.getOptions?.() ?? DEFAULT_KEY_OPTIONS).cancelAfterMs;
    idleTimer = ms > 0 ? setTimeout(cancel, ms) : undefined;
  };

  /** Pending at `next` (path already updated); arms the ambiguity timer when needed. */
  const settle = (next: SeqNode) => {
    const wasPending = node !== null;
    node = next;
    if (!wasPending) {
      for (const type of CANCEL_EVENTS) {
        win.addEventListener(type, onCancelEvent, true);
      }
      cancelActive = cancel;
    }
    setPendingKeys(path);
    armIdleTimer();
    clearTimeout(ambiguityTimer);
    ambiguityTimer = undefined;
    const ms = (deps.getOptions?.() ?? DEFAULT_KEY_OPTIONS).timeoutMs;
    if (next.commands && ms > 0) {
      // Both a binding and a prefix: run the shorter one if no key follows.
      ambiguityTimer = setTimeout(() => {
        const target = node;
        cancel();
        const hit = target && runnable(target.commands, deps.getContext());
        if (hit) {
          runHandler(hit.id, hit.handler);
        }
      }, ms);
    }
  };

  const walk = (chords: readonly Chord[]): SeqNode | null => {
    const root = deps.getSeqRoot?.();
    let current: SeqNode | undefined = root?.get(chords[0]);
    for (let i = 1; current && i < chords.length; i++) {
      current = current.next?.get(chords[i]);
    }
    return current ?? null;
  };

  const onPendingKey = (e: KeyboardEvent, chord: Chord) => {
    if (e.repeat || chord === "Escape" || chord === "Backspace") {
      claim(e);
    }
    if (e.repeat) {
      return;
    }
    if (chord === "Escape") {
      cancel();
      return;
    }
    if (chord === "Backspace") {
      const parent = path.length > 1 ? walk(path.slice(0, -1)) : null;
      if (parent) {
        path = path.slice(0, -1);
        settle(parent);
      } else {
        cancel();
      }
      return;
    }
    const child = (node as SeqNode).next?.get(chord);
    const ctx = deps.getContext();
    if (!child) {
      // Mismatch: cancel. Typing in a text field keeps the key (not claimed).
      cancel();
      if (!ctx.textEditing) {
        claim(e);
      }
      return;
    }
    claim(e);
    path = [...path, chord];
    if (child.next && hasLivePathBelow(child, ctx)) {
      settle(child);
      return;
    }
    cancel();
    const hit = runnable(child.commands, ctx);
    if (hit) {
      runHandler(hit.id, hit.handler);
    }
  };

  const hasLivePathBelow = (n: SeqNode, ctx: CommandContext): boolean => {
    for (const child of n.next?.values() ?? []) {
      if (hasLivePath(child, ctx)) {
        return true;
      }
    }
    return false;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (pauseCount > 0 || e.isComposing || e.keyCode === 229) {
      if (node && pauseCount > 0) {
        cancel();
      }
      return;
    }
    const chord = chordFromEvent(e, deps.platform);
    if (!chord) {
      return;
    }
    if (node) {
      onPendingKey(e, chord);
      return;
    }
    const candidates = deps.getKeymap().get(chord);
    const seq = deps.getSeqRoot?.()?.get(chord);
    if (!candidates && !seq) {
      return;
    }
    const ctx = deps.getContext();
    if (
      seq &&
      !(ctx.textEditing && !canStartInText(chord, deps.platform)) &&
      hasLivePathBelow(seq, ctx)
    ) {
      claim(e);
      if (!e.repeat) {
        path = [chord];
        settle(seq);
      }
      return;
    }
    if (!candidates) {
      return;
    }
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
      claim(e);
      if (!e.repeat || command.repeat) {
        runHandler(command.id, handler);
      }
      return;
    }
  };
  win.addEventListener("keydown", onKeyDown, true);
  return () => {
    cancel();
    win.removeEventListener("keydown", onKeyDown, true);
  };
}
