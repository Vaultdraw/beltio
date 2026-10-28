/**
 * Toast queue: pure state transitions, no timers and no React. The host owns
 * the single timer (see components/Toasts.tsx); callers pass `now`.
 */

export type ToastAction = { label: string; run: () => void };

export type Toast = {
  id: number;
  message: string;
  /** Errors stay a little longer. */
  kind: "info" | "error";
  action?: ToastAction;
  /** Infinity while held (hover/focus) or when the lifetime is 0 (stay until dismissed). */
  expiresAt: number;
  /** Time left when a hover/focus hold began; the timer restarts from it on release. */
  heldLeftMs?: number;
  /** A sticky toast (lifetime 0) never expires, held or not. */
  sticky?: boolean;
};

export type ToastInput = {
  message: string;
  kind?: Toast["kind"];
  action?: ToastAction;
  /** Overrides the default lifetime; 0 means stay until dismissed. */
  durationMs?: number;
};

export type ToastQueue = { toasts: Toast[]; nextId: number };

export const MAX_VISIBLE = 3;
export const INFO_MS = 5000;
export const ERROR_MS = 8000;
/** A toast with an action (Undo) gives time to reach it. */
export const ACTION_MS = 8000;

export const emptyQueue = (): ToastQueue => ({ toasts: [], nextId: 1 });

/** Lifetime in ms; Infinity for 0 (sticky). */
const lifetime = (input: ToastInput): number => {
  const ms =
    input.durationMs ??
    (input.action ? ACTION_MS : input.kind === "error" ? ERROR_MS : INFO_MS);
  return ms <= 0 ? Infinity : ms;
};

/**
 * Adds a toast. The same message while it is still showing refreshes that
 * toast (new expiry, latest action) instead of stacking a duplicate; beyond
 * MAX_VISIBLE the oldest goes.
 */
export function pushToast(
  queue: ToastQueue,
  input: ToastInput,
  now: number,
): ToastQueue {
  const kind = input.kind ?? "info";
  const life = lifetime(input);
  const expiresAt = now + life;
  const sticky = life === Infinity;
  const same = queue.toasts.find(
    (t) => t.message === input.message && t.kind === kind,
  );
  if (same) {
    return {
      ...queue,
      toasts: queue.toasts.map((t) =>
        t === same
          ? {
              ...t,
              expiresAt,
              sticky,
              heldLeftMs: undefined,
              action: input.action,
            }
          : t,
      ),
    };
  }
  const toast: Toast = {
    id: queue.nextId,
    message: input.message,
    kind,
    action: input.action,
    expiresAt,
    sticky,
  };
  return {
    nextId: queue.nextId + 1,
    toasts: [...queue.toasts, toast].slice(-MAX_VISIBLE),
  };
}

export function dismissToast(queue: ToastQueue, id: number): ToastQueue {
  return queue.toasts.some((t) => t.id === id)
    ? { ...queue, toasts: queue.toasts.filter((t) => t.id !== id) }
    : queue;
}

/** Hover or focus: the toast stops counting down (its time left is kept). */
export function holdToast(
  queue: ToastQueue,
  id: number,
  now: number,
): ToastQueue {
  const t = queue.toasts.find((x) => x.id === id);
  if (!t || t.sticky || t.heldLeftMs !== undefined) {
    return queue;
  }
  const heldLeftMs = Math.max(0, t.expiresAt - now);
  return {
    ...queue,
    toasts: queue.toasts.map((x) =>
      x === t ? { ...x, heldLeftMs, expiresAt: Infinity } : x,
    ),
  };
}

/** Pointer or focus leaves: the countdown resumes, with at least a moment to read. */
export function releaseToast(
  queue: ToastQueue,
  id: number,
  now: number,
  minMs = 2000,
): ToastQueue {
  const t = queue.toasts.find((x) => x.id === id);
  if (!t || t.heldLeftMs === undefined) {
    return queue;
  }
  const left = Math.max(t.heldLeftMs, minMs);
  return {
    ...queue,
    toasts: queue.toasts.map((x) =>
      x === t ? { ...x, heldLeftMs: undefined, expiresAt: now + left } : x,
    ),
  };
}

/** Drops toasts whose time is up. */
export function expireToasts(queue: ToastQueue, now: number): ToastQueue {
  const live = queue.toasts.filter((t) => t.expiresAt > now);
  return live.length === queue.toasts.length
    ? queue
    : { ...queue, toasts: live };
}

/** When the host should next wake up, or null when nothing is showing. */
export function nextExpiry(queue: ToastQueue): number | null {
  const times = queue.toasts.map((t) => t.expiresAt).filter(Number.isFinite);
  return times.length === 0 ? null : Math.min(...times);
}
