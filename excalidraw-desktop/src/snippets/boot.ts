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
import {
  getSettingsStatus,
  PREFERENCES_CHANGED_EVENT,
} from "../vault/settingsSync";
import { isTauriAvailable } from "../vault/DesktopVaultRepository";
import { scheduleIdle } from "../platform/idle";
import { toastStore } from "../toasts/toastStore";
import { touchesConfigSubdir } from "../vault/configPaths";

import { SNIPPET_COMMAND_IDS, SNIPPET_TOGGLE_PREFIX } from "./snippetCommands";
import {
  getSnippetSource,
  getSnippetsState,
  openSnippetsDir,
  reloadSnippets,
  snippetsOutOfDate,
  toggleSnippet,
} from "./store";

const IDLE = { timeout: 5000, fallbackMs: 1000 };

type ListenFn = <T>(
  event: string,
  handler: (e: { payload: T }) => void,
) => Promise<() => void>;

export interface SnippetBootDeps {
  listen?: ListenFn;
  /** Schedules the idle listing (default requestIdleCallback / setTimeout). */
  idle?: (run: () => void) => () => void;
}

/** True when a `config-change` batch concerns `<config>/snippets/`. */
export const touchesSnippets = (
  paths: unknown,
  configDir: string | null = getSettingsStatus().configDir,
): boolean => touchesConfigSubdir(paths, "snippets", configDir);

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
  const reload = () => reloadSnippets(doc, win);

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
    registerCommandPrefixHandler(SNIPPET_TOGGLE_PREFIX, (name) =>
      toggleSnippet(doc, win, name).catch((err) =>
        report(err instanceof Error ? err.message : String(err)),
      ),
    ),
  );

  // config.toml edited by hand (or another window): follow the list. The
  // store remembers what the last reload applied, whoever triggered it.
  const onPrefs = () => {
    if (snippetsOutOfDate(win)) {
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
      (deps.idle ?? ((run) => scheduleIdle(win, run, IDLE)))(() => {
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
