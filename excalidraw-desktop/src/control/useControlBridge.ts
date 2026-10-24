import { useEffect, useRef } from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { getPreferences, subscribePreferences } from "../vault/preferences";
import { toastStore } from "../toasts/toastStore";

import { onCommandRan } from "../commands/dispatcher";

import { createControlBridge, type ControlDeps } from "./bridge";
import { ControlError } from "./errors";
import { linkPrompt, linkRequests } from "./linkRequests";
import { createUriRunner, type UriDeps, type UriPlan } from "./uriRun";

import { commandInfos, createSnapshotSender } from "./commandsSnapshot";
import { createWindowMethods } from "./windowMethods";
import { tabListResult } from "./tabList";
import { createWindowEvents, type WindowEvents } from "./windowEvents";

import type { ControlFiles } from "./windowMethods";
import type { TabStore } from "../tabs/tabStore";

type Invoke = ControlDeps["invoke"];

const SNAPSHOT_DEBOUNCE_MS = 1000;

export const CLI_INSTALL_ID = "cli.install";
export const CLI_INSTALL_SYSTEM_ID = "cli.installSystem";

/** One animation frame, or 50 ms when the window is hidden and frames pause. */
const scheduleSoon = (win: Window, cb: () => void): (() => void) => {
  let done = false;
  const run = () => {
    if (!done) {
      done = true;
      cancel();
      cb();
    }
  };
  const raf = win.requestAnimationFrame(run);
  const timer = win.setTimeout(run, 50);
  const cancel = () => {
    done = true;
    win.cancelAnimationFrame(raf);
    win.clearTimeout(timer);
  };
  return cancel;
};

const inTauri = (win: Window) => "__TAURI_INTERNALS__" in win;

/** The window's own part of the link runner's deps; the dialogs and toasts are shared. */
const uriDeps = (
  win: Window,
  part: () => Pick<
    UriDeps,
    "vault" | "recentVaults" | "commandTitle" | "openSearch"
  >,
): Omit<UriDeps, "call"> => ({
  // Each call asks `part()` again: the app shell's closures change every render.
  vault: () => part().vault(),
  recentVaults: () => part().recentVaults(),
  commandTitle: (id) => part().commandTitle(id),
  openSearch: (query) => part().openSearch(query),
  ask: linkRequests.ask,
  notify: (message, kind) => toastStore.push({ message, kind }),
  sleep: (ms) => new Promise((r) => win.setTimeout(r, ms)),
});

/** Palette handler: ask for a link, then let Rust run it as the user's own. */
const openUri = () => {
  linkPrompt.open((url) => {
    // Rust shows every refusal itself (a notice in this window): nothing to add on failure.
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("uri_open", { url }))
      .catch(() => {});
  });
};

/** Palette handlers: install the `vaultdraw` command (user PATH or /usr/local/bin). */
const installCli = (system: boolean) => async () => {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { path } = (await invoke("control_install_cli", { system })) as {
      path: string;
    };
    toastStore.push({ message: `Installed 'vaultdraw' command at ${path}` });
  } catch (e) {
    toastStore.push({
      message: e instanceof Error ? e.message : String(e),
      kind: "error",
    });
  }
};

/**
 * Connects the window to the Rust control server: one event listener, no
 * polling, a debounced command-list snapshot after startup is idle. A no-op
 * outside Tauri (browser e2e harness).
 */
export function useControlBridge(
  win: Window | null,
  deps: Pick<ControlDeps, "runner" | "appState" | "openTarget"> & {
    /** Link effects only the app shell knows (see uriRun.ts). */
    uri?: Pick<
      UriDeps,
      "vault" | "recentVaults" | "commandTitle" | "openSearch"
    >;
    files?: ControlFiles;
    tabStore?: TabStore | null;
    activePath?: string | null;
  },
): void {
  const live = useRef(deps);
  live.current = deps;
  const events = useRef<WindowEvents | null>(null);

  // Cheap hooks into the live events object; no-ops until a topic is wanted.
  useEffect(() => {
    events.current?.setTabStore(deps.tabStore ?? null);
  }, [deps.tabStore]);
  useEffect(() => {
    events.current?.activePathChanged(deps.activePath ?? null);
  }, [deps.activePath]);

  useEffect(
    () =>
      registerCommandHandlers({
        [CLI_INSTALL_ID]: installCli(false),
        [CLI_INSTALL_SYSTEM_ID]: installCli(true),
        "links.openUri": openUri,
      }),
    [],
  );

  useEffect(() => {
    if (!win || !inTauri(win)) {
      // Browser e2e harness only: it sets `__controlMethodsSink` to receive
      // the window methods (no bridge, no Tauri). Compiled out of every other
      // build, so no page can grab the method table.
      const sink =
        import.meta.env.VITE_APP_E2E === "true"
          ? (win as any)?.__controlMethodsSink
          : undefined;
      if (typeof sink === "function") {
        const methods = createWindowMethods(
          () => live.current.files as ControlFiles,
        );
        const w = win as Window;
        if (live.current.uri) {
          const runner = createUriRunner({
            ...uriDeps(w, () => live.current.uri!),
            call: async (m, p) => {
              const fn = methods[m];
              if (!fn) {
                throw new ControlError("NOT_FOUND", "Unknown window method");
              }
              return fn(p);
            },
          });
          methods["uri.run"] = (p) => runner.run(p as UriPlan);
        }
        sink(methods);
      }
      return;
    }
    let disposed = false;
    let stop: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | null = null;

    void (async () => {
      try {
        const [{ invoke }, { listen }] = await Promise.all([
          import("@tauri-apps/api/core"),
          import("@tauri-apps/api/event"),
        ]);
        if (disposed) {
          return;
        }
        const call = invoke as Invoke;
        const overrides = () => getPreferences(win).hotkeys;
        const winEvents = createWindowEvents({
          publish: (topic, name, data) =>
            void call("control_event", { topic, name, data }).catch(() => {}),
          onCommandRan,
          tabList: () => {
            const l = live.current;
            const dirty = l.appState().activeDrawing;
            return tabListResult(l.tabStore?.getState() ?? null, dirty);
          },
          schedule: (cb) => scheduleSoon(win, cb),
        });
        events.current = winEvents;
        winEvents.setTabStore(live.current.tabStore ?? null);
        const bridge = createControlBridge({
          listen: listen as unknown as ControlDeps["listen"],
          invoke: call,
          overrides,
          runner: () => live.current.runner(),
          appState: () => live.current.appState(),
          openTarget: (t, c) => live.current.openTarget(t, c),
          files: () => live.current.files as ControlFiles,
          uri: live.current.uri
            ? () => uriDeps(win, () => live.current.uri!)
            : undefined,
          onReady: (topics) => winEvents.setTopics(topics),
        });
        const send = createSnapshotSender((commands) =>
          call("control_commands_snapshot", {
            commands,
          }),
        );
        const push = () =>
          void send(commandInfos(overrides(), live.current.runner().platform));
        const schedule = () => {
          clearTimeout(timer);
          timer = setTimeout(push, SNAPSHOT_DEBOUNCE_MS);
        };
        const unlisten = await bridge.start();
        if (disposed) {
          unlisten();
          return;
        }
        const offTopics = await (listen as unknown as ControlDeps["listen"])(
          "control-topics",
          (e) =>
            winEvents.setTopics(
              (e.payload as unknown as { topics?: string[] }).topics ?? [],
            ),
        );
        stop = () => {
          unlisten();
          offTopics();
        };
        unsubscribe = subscribePreferences(schedule);
        const idle = (
          win as Window & {
            requestIdleCallback?: (cb: () => void) => number;
          }
        ).requestIdleCallback;
        if (idle) {
          idle.call(win, push);
        } else {
          schedule();
        }
      } catch {
        // Control server not available: the bridge stays off.
      }
    })();

    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe?.();
      stop?.();
      events.current?.dispose();
      events.current = null;
    };
  }, [win]);
}
