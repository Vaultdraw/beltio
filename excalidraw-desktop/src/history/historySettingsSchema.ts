/**
 * Schema rows and the sidebar page of Settings > History. Spread into
 * components/settings/schema.ts with one line each; the controls live in
 * components/settings/pages/History.tsx. Pure data.
 */
import type {
  SettingSchema,
  SettingsPage,
} from "../components/settings/schema";

export const HISTORY_SETTINGS_PAGES: readonly SettingsPage[] = [
  {
    id: "history",
    label: "History",
    group: "Vault",
    intro: "Earlier versions of each drawing, kept inside the vault.",
    testId: "history-settings-page",
  },
];

const row = (
  s: Omit<SettingSchema, "page" | "keywords"> & { keywords?: string[] },
): SettingSchema => ({
  page: "history",
  perVault: false,
  ...s,
  keywords: ["history", "versions", ...(s.keywords ?? [])],
});

export const HISTORY_SETTINGS_SCHEMA: readonly SettingSchema[] = [
  row({
    id: "history-enabled",
    label: "Enable history",
    description:
      "Keep earlier versions of your drawings so you can look back and restore them. Off stops making versions.",
    keywords: ["kill switch", "off", "disable", "time machine", "backup"],
    configKey: "history.enabled",
    perVault: true,
  }),
  row({
    id: "history-interval",
    label: "Version interval (minutes)",
    description:
      "How often a version is saved while you draw. 0 means no timed versions.",
    keywords: ["autosave", "frequency", "timed", "minutes"],
    configKey: "history.interval_minutes",
    perVault: true,
  }),
  row({
    id: "history-keep-all",
    label: "Keep every version for (hours)",
    description: "Recent versions are all kept for this long. 0 keeps none.",
    keywords: ["retention", "thin", "keep all"],
    configKey: "history.keep_all_hours",
    perVault: true,
  }),
  row({
    id: "history-keep-hourly",
    label: "Then keep one per hour for (hours)",
    description: "After that, one version per hour is kept for this long.",
    keywords: ["retention", "thin", "hourly"],
    configKey: "history.keep_hourly_hours",
    perVault: true,
  }),
  row({
    id: "history-keep-daily",
    label: "Then keep one per day for (days)",
    description: "After that, one version per day is kept for this long.",
    keywords: ["retention", "thin", "daily"],
    configKey: "history.keep_daily_days",
    perVault: true,
  }),
  row({
    id: "history-keep-weekly",
    label: "Then keep one per week for (weeks)",
    description:
      "After that, one version per week is kept. 0 keeps weekly versions forever.",
    keywords: ["retention", "thin", "weekly", "forever"],
    configKey: "history.keep_weekly_weeks",
    perVault: true,
  }),
  row({
    id: "history-retention-preset",
    label: "Retention preset",
    description:
      "Restore the four retention values above to the Time Machine defaults: 1 hour, 24 hours, 30 days, then weekly forever.",
    keywords: ["reset", "default", "time machine", "retention"],
  }),
  row({
    id: "history-size-cap",
    label: "Size limit (MB)",
    description:
      "History of a vault is thinned, oldest automatic versions first, to stay under this size. 0 means no limit. Checkpoints are never removed automatically.",
    keywords: ["cap", "disk", "space", "storage", "megabytes", "usage"],
    configKey: "history.size_cap_mb",
    perVault: true,
  }),
  row({
    id: "history-highlight",
    label: "Highlight changes in preview",
    description:
      "Mark what was added, removed or changed when you preview a version.",
    keywords: ["diff", "compare", "changes", "overlay"],
    configKey: "history.highlight_changes",
    perVault: true,
  }),
  row({
    id: "history-privacy",
    label: "Privacy",
    description:
      "History syncs with your vault, so removed content stays readable in history until it is thinned or you delete it.",
    keywords: ["sync", "delete", "removed", "secret"],
  }),
  row({
    id: "history-git",
    label: "Exclude history from git",
    description:
      "Adds the history folder to this vault's .gitignore so versions are not committed. Shown for git vaults.",
    keywords: ["gitignore", "git", "repository", "commit"],
  }),
  row({
    id: "history-delete-all",
    label: "Delete all history of the open drawing",
    description:
      "Removes every version and checkpoint of the open drawing on all synced devices.",
    keywords: ["erase", "remove", "clear", "wipe", "purge"],
  }),
];
