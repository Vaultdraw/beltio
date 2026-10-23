/**
 * Starts CSS snippets for one window (lazy chunk, loaded after the first
 * frame by useSnippets): binds the commands, follows `appearance.snippets`
 * and file changes in `snippets/`, and lists the folder once when idle so
 * each snippet has a palette command. No source (plain browser) = nothing.
 *
 * Live reload reuses the config-dir watcher (`config-change`); there is no
 * polling and no work unless a changed path is inside `snippets/`.
 */
import {
  registerCommandHandlers,
  registerCommandPrefixHandler,
} from "../commands/handlerRegistry";
import { PREFERENCES_CHANGED_EVENT } from "../vault/settingsSync";
import { isTauriAvailable } from "../vault/DesktopVaultRepository";
import { toastStore } from "../toasts/toastStore";

import { SNIPPET_COMMAND_IDS, SNIPPET_TOGGLE_PREFIX } from "./snippetCommands";
import {
  enabledSnippetNames,
  getSnippetSource,
  getSnippetsState,
  openSnippetsDir,
  reloadSnippets,
  toggleSnippet,
} from "./store";

type ListenFn = <T>(
  event: string,
  handler: (e: { payload: T }) => void,
) => Promise<() => void>;

export interface SnippetBootDeps {
  listen?: ListenFn;
  /** Schedules the idle listing (default requestIdleCallback / setTimeout). */
  idle?: (run: () => void) => () => void;
}

/** True when a `config-change` batch touched `<config>/snippets/`. */
export const touchesSnippets = (paths: unknown): boolean =>
  Array.isArray(paths) &&
  paths.some((p) => typeof p === "string" && /[\\/]snippets([\\/]|$)/i.test(p));

const defaultIdle =
  (win: Window) =>
  (run: () => void): (() => void) => {
    const w = win as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(run, { timeout: 5000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = win.setTimeout(run, 1000);
    return () => win.clearTimeout(id);
  };

const report = (message: string) => {
  toastStore.push({ kind: "error", message });
};

export function startSnippets(
  doc: Document,
  win: Window,
  deps: SnippetBootDeps = {},
): () => void {
  if (!getSnippetSource(win)) {
    return () => {};
  }
  let disposed = false;
  const disposers: (() => void)[] = [];
  let appliedKey = enabledSnippetNames(win).join("\n");
  const reload = () => {
    appliedKey = enabledSnippetNames(win).join("\n");
    return reloadSnippets(doc, win);
  };

  disposers.push(
    registerCommandHandlers({
      [SNIPPET_COMMAND_IDS.reload]: () => reload(),
      [SNIPPET_COMMAND_IDS.openFolder]: () =>
        openSnippetsDir(win).catch((err) =>
          report(
            `Could not open the snippets folder: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        ),
    }),
    registerCommandPrefixHandler(SNIPPET_TOGGLE_PREFIX, async (name) => {
      await toggleSnippet(doc, win, name);
      appliedKey = enabledSnippetNames(win).join("\n");
    }),
  );

  // config.toml edited by hand (or another window): follow the list.
  const onPrefs = () => {
    if (enabledSnippetNames(win).join("\n") !== appliedKey) {
      void reload();
    }
  };
  win.addEventListener(PREFERENCES_CHANGED_EVENT, onPrefs);
  disposers.push(() =>
    win.removeEventListener(PREFERENCES_CHANGED_EVENT, onPrefs),
  );

  if (deps.listen || isTauriAvailable(win)) {
    void (async () => {
      try {
        const listen =
          deps.listen ??
          ((await import("@tauri-apps/api/event"))
            .listen as unknown as ListenFn);
        const off = await listen<{ paths?: string[] }>("config-change", (e) => {
          if (touchesSnippets(e?.payload?.paths)) {
            void reload();
          }
        });
        if (disposed) {
          off();
        } else {
          disposers.push(off);
        }
      } catch {
        // No live reload; "CSS snippets: Reload" still works.
      }
    })();
  }

  // Enabled snippets are applied before the first paint (main.tsx); this
  // only fills the list for the palette and Settings, when the app is idle.
  if (!getSnippetsState().loaded) {
    disposers.push(
      (deps.idle ?? defaultIdle(win))(() => {
        if (!disposed && !getSnippetsState().loaded) {
          void reload();
        }
      }),
    );
  }

  return () => {
    disposed = true;
    disposers.forEach((d) => d());
  };
}
