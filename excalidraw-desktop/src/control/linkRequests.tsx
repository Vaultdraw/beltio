import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ConfirmModal } from "../components/ConfirmModal";
import { Dialog } from "../components/Dialog";

import type { AskSpec } from "./uriRun";

/**
 * Confirmation for links from outside (see uriRun.ts). A tiny store: callers
 * anywhere `ask`, only the host subscribes, so the app tree never re-renders
 * for a request. One modal at a time; the rest wait in order. The text is
 * shown as React text (never HTML).
 */
type Listener = () => void;

export function createLinkRequests() {
  let queue: readonly AskSpec[] = [];
  const listeners = new Set<Listener>();
  const set = (next: readonly AskSpec[]) => {
    queue = next;
    listeners.forEach((l) => l());
  };
  return {
    ask: (spec: AskSpec) => set([...queue, spec]),
    /** Closes the head request; runs its action only on confirm. */
    resolve: (confirmed: boolean) => {
      const [head, ...rest] = queue;
      set(rest);
      if (head && confirmed) {
        head.onConfirm();
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
      title={spec.title}
      message={spec.message}
      details={spec.details}
      confirmLabel={spec.confirmLabel}
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
          Runs as if you had clicked it, without asking again.
        </span>
      </div>
    </Dialog>
  );
};
