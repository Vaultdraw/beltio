import {
  ACTION_MS,
  ERROR_MS,
  dismissToast,
  emptyQueue,
  expireToasts,
  holdToast,
  pushToast,
  releaseToast,
  toastKind,
} from "./queue";

import type { Toast, ToastInput, ToastQueue } from "./queue";

type Listener = () => void;

/**
 * The user's notice time applies to every error toast (bug hunt BH-5): 0 keeps it until
 * dismissed, buttons or not; a toast with a button stays at least as long as any action toast.
 */
const errorLifetime = (input: ToastInput, errorMs: number): number =>
  errorMs === 0 || !(input.action || input.actions?.length)
    ? errorMs
    : Math.max(errorMs, ACTION_MS);

/** Tiny external store: callers anywhere push, only the host subscribes, so the app tree never re-renders for a toast. */
export function createToastStore(now: () => number = Date.now) {
  let queue: ToastQueue = emptyQueue();
  /** Lifetime of error toasts (`interface.notice_seconds`); 0 = until dismissed. */
  let errorMs = ERROR_MS;
  const listeners = new Set<Listener>();
  const set = (next: ToastQueue) => {
    if (next !== queue) {
      queue = next;
      listeners.forEach((l) => l());
    }
  };
  return {
    /** Returns the id of the toast now showing this message. */
    push: (input: ToastInput): number | undefined => {
      const kind = toastKind(input);
      set(
        pushToast(
          queue,
          kind === "error" && input.durationMs === undefined
            ? { ...input, durationMs: errorLifetime(input, errorMs) }
            : input,
          now(),
        ),
      );
      return queue.toasts.find((t) =>
        input.key
          ? t.key === input.key
          : t.message === input.message && t.kind === kind,
      )?.id;
    },
    setErrorMs: (ms: number) => {
      errorMs = ms;
    },
    hold: (id: number) => set(holdToast(queue, id, now())),
    release: (id: number) => set(releaseToast(queue, id, now())),
    dismiss: (id: number) => set(dismissToast(queue, id)),
    expire: () => set(expireToasts(queue, now())),
    clear: () => set(emptyQueue()),
    getSnapshot: (): ToastQueue => queue,
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    now,
  };
}

export type ToastStore = ReturnType<typeof createToastStore>;
export type { Toast };

/** The app's one store. */
export const toastStore = createToastStore();
