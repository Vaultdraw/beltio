/** Settings row for `files.auto_reload`. Spread into components/settings/schema.ts. */
import type { SettingSchema } from "../components/settings/schema";

export const WATCH_SETTINGS_SCHEMA: readonly SettingSchema[] = [
  {
    id: "files-auto-reload",
    page: "files",
    label: "Reload when files change outside the app",
    description:
      "Watches the vault folder, so a file or folder you delete, add or rename in your file manager shows up in the tree at once. Off stops the watcher; Refresh (Cmd+Shift+R) still updates the tree.",
    keywords: ["watch", "refresh", "reload", "finder", "external", "sync"],
    configKey: "files.auto_reload",
    perVault: false,
  },
];
