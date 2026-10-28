import { useEffect, useSyncExternalStore } from "react";

import { nextExpiry } from "../toasts/queue";
import { toastStore } from "../toasts/toastStore";

import { IconClose } from "./Icons";

import "./feedback.css";

import type { ToastStore } from "../toasts/toastStore";
import type { KeyboardEvent } from "react";

/**
 * Bottom-right toasts. Renders nothing (and keeps no timer) while the queue is
 * empty; one timeout at a time, for the earliest expiry. Hovering or focusing a
 * toast pauses its countdown; Escape on a focused toast dismisses it.
 */
export const Toasts = ({ store = toastStore }: { store?: ToastStore }) => {
  const queue = useSyncExternalStore(store.subscribe, store.getSnapshot);

  useEffect(() => {
    const at = nextExpiry(queue);
    if (at === null) {
      return;
    }
    const timer = setTimeout(store.expire, Math.max(0, at - store.now()));
    return () => clearTimeout(timer);
  }, [queue, store]);

  if (queue.toasts.length === 0) {
    return null;
  }
  return (
    <div className="vd-toasts" role="region" aria-label="Notifications">
      <div className="vd-toasts__list">
        {queue.toasts.map((toast) => (
          <div
            key={toast.id}
            className={`vd-toast vd-toast--${toast.kind}`}
            role={toast.kind === "error" ? "alert" : "status"}
            aria-live={toast.kind === "error" ? undefined : "polite"}
            onMouseEnter={() => store.hold(toast.id)}
            onMouseLeave={() => store.release(toast.id)}
            onFocus={() => store.hold(toast.id)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                store.release(toast.id);
              }
            }}
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                store.dismiss(toast.id);
              }
            }}
          >
            <span className="vd-toast__text">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="vd-toast__action"
                onClick={() => {
                  store.dismiss(toast.id);
                  toast.action?.run();
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              className="vd-toast__close"
              aria-label="Dismiss notification"
              onClick={() => store.dismiss(toast.id)}
            >
              <IconClose />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
