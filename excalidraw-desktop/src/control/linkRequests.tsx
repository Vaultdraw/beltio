import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ConfirmModal } from "../components/ConfirmModal";
import { Dialog } from "../components/Dialog";
import { toastStore } from "../toasts/toastStore";

import type { AskSpec } from "./uriRun";

/**
 * Confirmation for links from outside (see uriRun.ts). A tiny store: callers
 * anywhere `ask`, only the host subscribes, so the app tree never re-renders
 * for a request. One modal at a time; the rest wait in order. The text is
 * shown as React text (never HTML).
 */
type Listener = () => void;

/** Questions waiting at most; the rest are dropped (one notice says how many). */
export const MAX_PENDING_REQUESTS = 3;

const sameRequest = (a: AskSpec, b: AskSpec) =>
  a.title === b.title &&
  a.confirmLabel === b.confirmLabel &&
  a.message === b.message &&
  (a.alternatives ?? []).map((x) => x.label).join("|") ===
    (b.alternatives ?? []).map((x) => x.label).join("|") &&
  a.details.length === b.details.length &&
  a.details.every((d, i) => d === b.details[i]);

export function createLinkRequests(
  /** Tells the user that requests were dropped. */
  notify: (message: string) => void = (message) => toastStore.push({ message }),
) {
  let queue: readonly AskSpec[] = [];
  let dropped = 0;
  let seq = 0;
  const ids = new WeakMap<AskSpec, number>();
  const listeners = new Set<Listener>();
  const set = (next: readonly AskSpec[]) => {
    queue = next;
    listeners.forEach((l) => l());
  };
  return {
    /** Queues a question. An identical one already waiting is merged; beyond the cap it is dropped. */
    ask: (spec: AskSpec) => {
      if (queue.some((q) => sameRequest(q, spec))) {
        return;
      }
      if (queue.length >= MAX_PENDING_REQUESTS) {
        dropped += 1;
        if (dropped === 1) {
          notify("Too many link requests: ignoring some");
        }
        return;
      }
      ids.set(spec, (seq += 1));
      set([...queue, spec]);
    },
    /** A key that is new for every request, so each dialog starts its own guard time. */
    keyOf: (spec: AskSpec): number => ids.get(spec) ?? 0,
    /** Closes the head request; runs its action only on confirm. */
    resolve: (confirmed: boolean, choice?: number) => {
      const [head, ...rest] = queue;
      set(rest);
      if (rest.length === 0 && dropped > 0) {
        notify(
          `${dropped} more link request${
            dropped === 1 ? " was" : "s were"
          } dropped`,
        );
        dropped = 0;
      }
      if (head && confirmed) {
        const alt =
          choice === undefined ? undefined : head.alternatives?.[choice];
        (alt ? alt.run : head.onConfirm)();
      }
    },
    head: (): AskSpec | null => queue[0] ?? null,
    subscribe: (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export type LinkRequests = ReturnType<typeof createLinkRequests>;

export const linkRequests = createLinkRequests();

/** Renders the head request; costs nothing (returns null) while none waits. */
export const LinkRequestHost = ({
  store = linkRequests,
}: {
  store?: LinkRequests;
}) => {
  const spec = useSyncExternalStore(store.subscribe, store.head, store.head);
  if (!spec) {
    return null;
  }
  return (
    <ConfirmModal
      key={store.keyOf(spec)}
      guarded
      title={spec.title}
      message={spec.message}
      details={spec.details}
      confirmLabel={spec.confirmLabel}
      alternatives={spec.alternatives?.map((alt, i) => ({
        label: alt.label,
        onChoose: () => store.resolve(true, i),
      }))}
      onConfirm={() => store.resolve(true)}
      onCancel={() => store.resolve(false)}
    />
  );
};

/** The palette's "Open a vaultdraw:// link": one line of text, then `onSubmit(url)`. */
type Prompt = { onSubmit: (url: string) => void } | null;

export function createLinkPrompt() {
  let current: Prompt = null;
  const listeners = new Set<Listener>();
  const set = (next: Prompt) => {
    current = next;
    listeners.forEach((l) => l());
  };
  return {
    open: (onSubmit: (url: string) => void) => set({ onSubmit }),
    close: () => set(null),
    current: (): Prompt => current,
    subscribe: (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export type LinkPrompt = ReturnType<typeof createLinkPrompt>;

export const linkPrompt = createLinkPrompt();

export const LinkPromptHost = ({
  store = linkPrompt,
}: {
  store?: LinkPrompt;
}) => {
  const prompt = useSyncExternalStore(
    store.subscribe,
    store.current,
    store.current,
  );
  const [text, setText] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (prompt) {
      setText("");
      ref.current?.focus();
    }
  }, [prompt]);
  if (!prompt) {
    return null;
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = text.trim();
    if (url) {
      store.close();
      prompt.onSubmit(url);
    }
  };
  return (
    <Dialog
      title="Open a link"
      titleId="link-prompt-title"
      onClose={store.close}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="vault-btn" onClick={store.close}>
            Cancel
          </button>
          <button
            type="submit"
            className="vault-btn vault-btn--primary"
            disabled={!text.trim()}
          >
            Open
          </button>
        </>
      }
    >
      <div className="vault-field">
        <label htmlFor="link-prompt-input">vaultdraw:// link</label>
        <input
          id="link-prompt-input"
          ref={ref}
          type="text"
          className="vault-input"
          placeholder="vaultdraw://open?file=Graphs/BFS"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <span className="vd-dialog__hint">
          Runs as if the system had opened it. It still asks before it creates,
          runs a command or switches vault.
        </span>
      </div>
    </Dialog>
  );
};
