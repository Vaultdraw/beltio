/**
 * Schema rows of the "Tabs" section on the Interface settings page. Spread
 * into components/settings/schema.ts with one line. Pure data.
 */
import { modKeyWord } from "../platform/platformWords";

import type { SettingSchema } from "../components/settings/schema";

const row = (
  s: Omit<SettingSchema, "page" | "keywords" | "perVault"> & {
    keywords?: string[];
    perVault?: boolean;
  },
): SettingSchema => ({
  page: "interface",
  perVault: false,
  ...s,
  keywords: ["tabs", "tab", ...(s.keywords ?? [])],
});

export const TABS_SETTINGS_SCHEMA: readonly SettingSchema[] = [
  row({
    id: "tabs-enabled",
    heading: "Tabs",
    label: "Enable tabs",
    description:
      "Open several drawings at once. Off goes back to one drawing at a time.",
    keywords: ["buffers", "multiple", "disable", "single"],
    configKey: "tabs.enabled",
  }),
  row({
    id: "tabs-show-strip",
    label: "Show tab strip",
    description: "Hide the strip to switch tabs with the keyboard only.",
    keywords: ["bar", "hide", "keyboard"],
    configKey: "tabs.show_strip",
  }),
  row({
    id: "tabs-open-from-navigator",
    label: "Open drawings from the file tree in",
    description: `Current tab replaces the open drawing; New tab keeps it open. ${modKeyWord()}+click does the other one.`,
    keywords: ["navigator", "click", "new tab", "replace", "browser"],
    configKey: "tabs.open_from_navigator",
    perVault: true,
  }),
  row({
    id: "tabs-focus-new",
    label: "Switch to a new tab when it opens",
    description: "Turn off to open drawings in the background.",
    keywords: ["focus", "background", "activate"],
    configKey: "tabs.focus_new",
  }),
  row({
    id: "tabs-new-tab-position",
    label: "New tabs open",
    description: "Right after the active tab, or at the end of the strip.",
    keywords: ["position", "order", "end", "after active"],
    configKey: "tabs.new_tab_position",
  }),
  row({
    id: "tabs-ctrl-tab",
    label: "Ctrl+Tab goes to",
    description: "The last used tab, or the next tab in the strip.",
    keywords: ["switch", "recent", "mru", "order", "cycle"],
    configKey: "tabs.ctrl_tab",
  }),
  row({
    id: "tabs-close-pinned",
    label: "Close pinned tabs with the shortcut",
    description: "Off keeps pinned tabs open until you unpin them.",
    keywords: ["pin", "pinned", "close", "protect"],
    configKey: "tabs.close_pinned",
  }),
  row({
    id: "tabs-restore",
    label: "Restore open tabs when a vault opens",
    description: "Reopen the tabs you had open last time.",
    keywords: ["session", "reopen", "startup", "remember"],
    configKey: "tabs.restore",
    perVault: true,
  }),
  row({
    id: "tabs-undo-budget",
    label: "Keep undo history for background tabs (MB)",
    description:
      "Undo history kept in memory for tabs you switched away from. 0 drops it when you switch.",
    keywords: ["undo", "memory", "ram", "budget", "history"],
    configKey: "tabs.undo_budget_mb",
  }),
];
