import { getActiveEditor, onActiveEditorChange } from "../editor/editorApi";

/** How long a control call waits for the editor to show a drawing it just opened. */
export const EDITOR_WAIT_MS = 5000;

const same = (a: string, b: string) =>
  a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase();

export interface EditorReadyDeps {
  current?: () => { path: string | null } | null;
  subscribe?: (cb: () => void) => () => void;
  ms?: number;
}

/**
 * Resolves true once the editor shows `path` (at once when it already does), false after `ms`.
 * `open X` then `scene read` is a normal script: the editor mounts a moment after the tab opens,
 * so the open must not answer before it can be read (Neovim's RPC calls finish their effect).
 */
export const waitForEditor = (
  path: string,
  deps: EditorReadyDeps = {},
): Promise<boolean> => {
  const current = deps.current ?? getActiveEditor;
  const subscribe = deps.subscribe ?? onActiveEditorChange;
  const shown = () => {
    const p = current()?.path;
    return !!p && same(p, path);
  };
  if (shown()) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) {
        return;
      }
      done = true;
      unsubscribe();
      clearTimeout(timer);
      clearInterval(poll);
      resolve(ok);
    };
    const check = () => shown() && finish(true);
    const unsubscribe = subscribe(check);
    // A rename changes the path without a notification: look again now and then.
    const poll = setInterval(check, 100);
    const timer = setTimeout(() => finish(false), deps.ms ?? EDITOR_WAIT_MS);
  });
};
