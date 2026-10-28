/**
 * Sync-service commands (conflict copies from iCloud Drive, Dropbox, Syncthing, OneDrive).
 * Handlers are bound by `sync/useSyncConflicts.tsx`; a command without a handler is not offered.
 * They act on the open drawing: its conflict copy, or, when the open drawing is itself a
 * conflict copy, its original.
 */
import type { CommandDefinition } from "./types";

export const SYNC_COMMAND_IDS = {
  compare: "sync.compareWithConflictCopy",
  keepThis: "sync.keepThis",
  keepOther: "sync.keepOther",
} as const;

export const SYNC_COMMANDS: CommandDefinition[] = [
  {
    id: SYNC_COMMAND_IDS.compare,
    title: "Sync: Compare with conflict copy",
    category: "Sync",
    keys: { default: [] },
    when: ["drawingOpen", "!modalOpen"],
  },
  {
    id: SYNC_COMMAND_IDS.keepThis,
    title: "Sync: Keep this version (the other goes to history)",
    category: "Sync",
    keys: { default: [] },
    when: ["drawingOpen", "writable", "!modalOpen"],
  },
  {
    id: SYNC_COMMAND_IDS.keepOther,
    title: "Sync: Keep the other version (this one goes to history)",
    category: "Sync",
    keys: { default: [] },
    when: ["drawingOpen", "writable", "!modalOpen"],
  },
];
