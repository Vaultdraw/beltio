/**
 * Toast queue: pure state transitions, no timers and no React. The host owns
 * the single timer (see components/Toasts.tsx); callers pass `now`.
 */

export type ToastAction = { label: string; run: () => void };

/** The one notice design: a short title, an optional one-line detail, an optional progress bar, up to two buttons. */
export type ToastProgress = { done: number; total: number };

export type Toast = {
  id: number;
  /** The title: short, one line of what happened. */
  message: string;
  /** One line under the title (what failed, which file). */
  detail?: string;
  /** A bar with a count; a toast with progress stays up while it keeps being updated. */
  progress?: ToastProgress;
  /** Same key = the same notice: a push updates it in place instead of stacking. */
  key?: string;
  /** Buttons (Cancel, View report, Undo); `action` is the first one. */
  actions?: ToastAction[];
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
  detail?: string;
  progress?: ToastProgress;
  key?: string;
  /** Buttons; takes the place of `action`. */
  actions?: ToastAction[];
  kind?: Toast["kind"];
  action?: ToastAction;
  /** Overrides the default lifetime; 0 means stay until dismissed. */
  durationMs?: number;
};

export type ToastQueue = { toasts: Toast[]; nextId: number };

export const MAX_VISIBLE = 3;
export const MAX_ACTIONS = 2;
export const INFO_MS = 5000;
export const ERROR_MS = 8000;
/** A toast with an action (Undo) gives time to reach it. */
export const ACTION_MS = 8000;
/** A progress toast that is not updated for this long goes (its work died). */
export const PROGRESS_MS = 60000;

export const emptyQueue = (): ToastQueue => ({ toasts: [], nextId: 1 });

/** Lifetime in ms; Infinity for 0 (sticky). */
/** A message that reports a failure, as the app words them ("Could not …", "Couldn't …"). */
const FAILURE_WORDS =
  /^(Could not|Couldn['’]t|Cannot|Can['’]t|Failed|Unable)\b/;

/**
 * The toast's kind: what the caller says, else an error when the message reports a failure, so
 * every failure notice follows the user's "Error notices stay for" time and looks like an error,
 * whoever wrote it (toimprove 323). Otherwise info.
 */
export const toastKind = (input: ToastInput): Toast["kind"] =>
  input.kind ?? (isFailureMessage(input.message) ? "error" : "info");

/** Whether a notice's text reports a failure. */
export const isFailureMessage = (message: string): boolean =>
  FAILURE_WORDS.test(message);

const lifetime = (input: ToastInput): number => {
  const ms =
    input.durationMs ??
    (input.progress
      ? PROGRESS_MS
      : input.action || input.actions?.length
      ? ACTION_MS
      : toastKind(input) === "error"
      ? ERROR_MS
      : INFO_MS);
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
  const kind = toastKind(input);
  const life = lifetime(input);
  const expiresAt = now + life;
  const sticky = life === Infinity;
  const actions = (input.actions ?? (input.action ? [input.action] : [])).slice(
    0,
    MAX_ACTIONS,
  );
  const fields = {
    message: input.message,
    kind,
    detail: input.detail,
    progress: input.progress,
    key: input.key,
    actions,
    action: actions[0],
    expiresAt,
    sticky,
    heldLeftMs: undefined,
  };
  const same = input.key
    ? queue.toasts.find((t) => t.key === input.key)
    : queue.toasts.find(
        (t) => !t.key && t.message === input.message && t.kind === kind,
      );
  if (same) {
    return {
      ...queue,
      toasts: queue.toasts.map((t) => (t === same ? { ...t, ...fields } : t)),
    };
  }
  const toast: Toast = { id: queue.nextId, ...fields };
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
