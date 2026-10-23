/**
 * Plugin boot: with no plugin enabled nothing plugin-related loads. The host
 * chunk is imported on idle once the enabled list is non-empty.
 */
import { scheduleIdle } from "../platform/idle";
import { getPreferences, subscribePreferences } from "../vault/preferences";

import { pluginHostStarted } from "./hostFlag";

const onIdle = (win: Window, run: () => void) =>
  scheduleIdle(win, run, { fallbackMs: 200 });

let starting: Promise<void> | null = null;

/**
 * Starts the host if it isn't running (one start at a time, no-op once it
 * has started). Used by boot and by plugin management (Settings > Plugins,
 * rescan, install) so the list exists even with no plugin enabled.
 */
export function ensurePluginHost(win: Window): Promise<void> {
  if (pluginHostStarted.get()) {
    return Promise.resolve();
  }
  starting ??= import("./host/start")
    .then(({ startPluginHost }) => startPluginHost(win))
    .then(
      () => undefined,
      (error: unknown) => console.error("Plugin host failed to start", error),
    )
    .finally(() => {
      starting = null;
    });
  return starting;
}

const start = (win: Window) => void ensurePluginHost(win);

export function bootPlugins(win: Window): void {
  const enabled = () => getPreferences(win).pluginsEnabled.length > 0;
  if (enabled()) {
    onIdle(win, () => start(win));
    return;
  }
  const off = subscribePreferences(() => {
    if (enabled()) {
      off();
      onIdle(win, () => start(win));
    }
  });
}
