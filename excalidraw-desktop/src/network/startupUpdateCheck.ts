/**
 * The quiet update check: once per launch, a while after startup work has finished, never again.
 * It does nothing in Offline mode, with `updates.check_on_startup = false` or
 * `network.allow_updates = false`, and says something only when a newer version exists. Rust
 * checks the same switches again before any request (`update_check.rs`).
 */
import { openWebLink } from "../help/openExternal";
import { toastStore } from "../toasts/toastStore";
import { isTauriAvailable } from "../vault/DesktopVaultRepository";
import { getPreferences, isOffline } from "../vault/preferences";

export interface UpdateInfo {
  version: string;
  url: string;
}

export interface UpdateCheckDeps {
  invoke: (cmd: string) => Promise<UpdateInfo | null>;
  notify: (info: UpdateInfo) => void;
}

/** Wait this long after the app starts before looking, so startup work is never slowed. */
export const UPDATE_CHECK_DELAY_MS = 15_000;

let started = false;

/** Tests only: allow another check in this page. */
export const resetStartupUpdateCheck = () => {
  started = false;
};

const showNotice = (info: UpdateInfo) =>
  toastStore.push({
    message: `Vaultdraw ${info.version} is available`,
    key: "update-available",
    durationMs: 15_000,
    actions: [
      {
        label: "View release",
        run: () => void openWebLink(info.url, { label: "the release page" }),
      },
    ],
  });

/** Runs the check at most once per launch. Returns true when a request was made. */
export async function runStartupUpdateCheck(
  win: Window,
  deps: UpdateCheckDeps,
): Promise<boolean> {
  const prefs = getPreferences(win);
  if (
    started ||
    isOffline(prefs) ||
    !prefs.updatesCheckOnStartup ||
    prefs.networkAllowUpdates === false
  ) {
    return false;
  }
  started = true;
  try {
    const info = await deps.invoke("update_check");
    if (info) {
      deps.notify(info);
    }
  } catch {
    // Quiet by design: no notice for "no network" or "GitHub is down".
  }
  return true;
}

/** The test builds (perf, smoke, end-to-end) never reach out to the internet on their own. */
const isTestBuild = (): boolean =>
  import.meta.env.VITE_APP_PERF_TEST === "true" ||
  import.meta.env.VITE_APP_SMOKE_TEST === "true" ||
  import.meta.env.VITE_APP_E2E === "true";

/** Schedules the check after the delay; returns a function that cancels it. */
export function scheduleStartupUpdateCheck(
  win: Window,
  delayMs = UPDATE_CHECK_DELAY_MS,
): () => void {
  if (!isTauriAvailable(win) || started || isTestBuild()) {
    return () => undefined;
  }
  const timer = win.setTimeout(() => {
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      runStartupUpdateCheck(win, {
        invoke: (cmd) => invoke<UpdateInfo | null>(cmd),
        notify: showNotice,
      }),
    );
  }, delayMs);
  return () => win.clearTimeout(timer);
}
