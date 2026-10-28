/**
 * Schema rows of the "Sync" section on the Interface settings page. Spread into
 * components/settings/schema.ts with one line. Pure data.
 */
import type { SettingSchema } from "../components/settings/schema";

export const SYNC_SETTINGS_SCHEMA: readonly SettingSchema[] = [
  {
    id: "sync-conflict-badge",
    page: "interface",
    heading: "Sync services",
    label: "Mark conflict copies in the file tree",
    description:
      "Files that iCloud Drive, Dropbox or Syncthing made when two devices changed one drawing get a conflict badge.",
    keywords: [
      "sync",
      "conflict",
      "icloud",
      "dropbox",
      "syncthing",
      "onedrive",
      "copy",
    ],
    configKey: "sync.conflict_badge",
    perVault: false,
  },
  {
    id: "sync-download-placeholders",
    page: "interface",
    label: "Download iCloud files when you open them",
    description:
      "A drawing iCloud has not downloaded yet shows as not downloaded. Clicking it asks iCloud to fetch it. Off: only the Download button does.",
    keywords: ["sync", "icloud", "download", "placeholder", "evicted", "cloud"],
    configKey: "sync.download_placeholders",
    perVault: false,
  },
];
