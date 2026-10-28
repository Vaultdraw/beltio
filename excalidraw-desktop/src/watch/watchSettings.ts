/**
 * `[files] auto_reload`: preference field, config.toml key and default.
 * Pure data; preferences.ts and settingsSync.ts spread it in.
 */
import type { ConfigMapping } from "../vault/settingsSync";

export const WATCH_FIELDS = ["filesAutoReload"] as const;
export type WatchField = typeof WATCH_FIELDS[number];

export interface WatchPreferences {
  /** files.auto_reload: follow changes made outside the app (file manager, sync, git). */
  filesAutoReload: boolean;
}

export const WATCH_DEFAULTS: WatchPreferences = { filesAutoReload: true };

export const WATCH_MAPPINGS: readonly ConfigMapping[] = [
  {
    field: "filesAutoReload",
    key: "files.auto_reload",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
];

/** Stored preferences -> valid fields; a bad value gets the default. */
export const normalizeWatchPreferences = (
  input: Record<string, unknown>,
): WatchPreferences => ({
  filesAutoReload:
    typeof input.filesAutoReload === "boolean"
      ? input.filesAutoReload
      : WATCH_DEFAULTS.filesAutoReload,
});
