/**
 * Sync-service settings: preference fields, config.toml keys (`[sync]`), validation and
 * defaults. Pure data; settingsSync.ts / preferences.ts spread `SYNC_MAPPINGS`,
 * `SYNC_FIELDS` and `SYNC_DEFAULTS` in. Vaults inside iCloud Drive, Dropbox, Syncthing or
 * OneDrive: conflict copies, placeholders that are not downloaded yet.
 */
import type { ConfigMapping } from "../vault/settingsSync";

export const SYNC_FIELDS = [
  "syncConflictBadge",
  "syncDownloadPlaceholders",
] as const;
export type SyncField = typeof SYNC_FIELDS[number];

export interface SyncPreferences {
  /** Show a "conflict" badge on conflict copies in the file tree. */
  syncConflictBadge: boolean;
  /** Ask iCloud to download a "not downloaded" file when you click it (off: only the Download button does). */
  syncDownloadPlaceholders: boolean;
}

export const SYNC_DEFAULTS: SyncPreferences = {
  syncConflictBadge: true,
  syncDownloadPlaceholders: true,
};

const isBool = (v: unknown): v is boolean => typeof v === "boolean";

export const SYNC_MAPPINGS: readonly ConfigMapping[] = [
  {
    field: "syncConflictBadge",
    key: "sync.conflict_badge",
    expected: "true or false",
    valid: isBool,
  },
  {
    field: "syncDownloadPlaceholders",
    key: "sync.download_placeholders",
    expected: "true or false",
    valid: isBool,
  },
];

/** Stored (localStorage) preferences -> valid sync fields; bad ones default. */
export function normalizeSyncPreferences(
  input: Record<string, unknown>,
): SyncPreferences {
  return Object.fromEntries(
    SYNC_FIELDS.map((field) => [
      field,
      isBool(input[field]) ? input[field] : SYNC_DEFAULTS[field],
    ]),
  ) as unknown as SyncPreferences;
}
