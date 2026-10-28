import type { WatchFallback } from "./types";

/** The one notice shown when a vault is polled because the native file watcher could not start. */
export const watchFallbackMessage = (f: WatchFallback): string => {
  const every = `${f.intervalMs / 1000} s`;
  return f.reason === "limitReached"
    ? `The system's file watch limit is reached, so this vault is checked for changes every ${every}. To fix it, raise fs.inotify.max_user_watches (for example: sudo sysctl fs.inotify.max_user_watches=524288).`
    : `File watching could not start for this vault, so it is checked for changes every ${every}.`;
};
