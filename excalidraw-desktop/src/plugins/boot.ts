/**
 * Plugin boot: with no plugin enabled nothing plugin-related loads. The host
 * chunk is imported on idle once the enabled list is non-empty.
 */
import { getPreferences, subscribePreferences } from "../vault/preferences";

const onIdle = (win: Window, run: () => void) =>
  typeof win.requestIdleCallback === "function"
    ? win.requestIdleCallback(() => run())
    : win.setTimeout(run, 200);

const start = (win: Window) =>
  void import("./host/start")
    .then(({ startPluginHost }) => startPluginHost(win))
    .catch((error: unknown) =>
      console.error("Plugin host failed to start", error),
    );

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
