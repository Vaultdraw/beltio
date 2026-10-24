/**
 * Every History command id with its metadata (frozen at H1). Handlers are
 * bound where they live: useHistoryCommands (app level) and the panel
 * (registerCommandHandlers while it is mounted). A command without a handler
 * is simply not offered.
 */
import type { CommandDefinition } from "../commands/types";

export const HISTORY_COMMAND_IDS = {
  checkpoint: "history.checkpoint",
  toggle: "history.toggle",
  timeTravel: "history.timeTravel",
  previous: "history.previous",
  next: "history.next",
  restore: "history.restore",
  restoreReplace: "history.restoreReplace",
  restoreCopy: "history.restoreCopy",
  copySelection: "history.copySelection",
  exportExcalidraw: "history.exportExcalidraw",
  exportImage: "history.exportImage",
  toggleHighlights: "history.toggleHighlights",
  deleteCheckpoint: "history.deleteCheckpoint",
  deleteAll: "history.deleteAll",
  excludeFromGit: "history.excludeFromGit",
  // command audit (S8)
  backToCurrent: "history.backToCurrent",
  dismissGitNotice: "history.dismissGitNotice",
} as const;

const OPEN_DRAWING = ["drawingOpen", "!modalOpen"] as const;
const WRITABLE_DRAWING = ["drawingOpen", "writable", "!modalOpen"] as const;

const command = (
  id: string,
  title: string,
  keys: string[],
  when: CommandDefinition["when"],
  extra: Partial<CommandDefinition> = {},
): CommandDefinition => ({
  id,
  title: `History: ${title}`,
  category: "History",
  keys: { default: keys },
  when,
  ...extra,
});

const I = HISTORY_COMMAND_IDS;

export const HISTORY_COMMANDS: CommandDefinition[] = [
  // Option+S types a dead key on macOS; chords match by code.
  command(
    I.checkpoint,
    "Create checkpoint",
    ["Mod+Alt+S"],
    [...WRITABLE_DRAWING],
  ),
  command(I.toggle, "Show or hide history", ["Mod+Shift+H"], [...OPEN_DRAWING]),
  command(I.timeTravel, "Time travel", [], [...OPEN_DRAWING]),
  command(I.previous, "Previous version", [], [...OPEN_DRAWING], {
    repeat: true,
  }),
  command(I.next, "Next version", [], [...OPEN_DRAWING], { repeat: true }),
  command(I.restore, "Restore this version", [], [...WRITABLE_DRAWING]),
  command(
    I.restoreReplace,
    "Restore by replacing the drawing",
    [],
    [...WRITABLE_DRAWING],
  ),
  command(I.restoreCopy, "Restore as a copy", [], [...OPEN_DRAWING]),
  command(
    I.copySelection,
    "Copy selection to the drawing",
    [],
    [...WRITABLE_DRAWING],
  ),
  command(
    I.exportExcalidraw,
    "Export version as .excalidraw",
    [],
    [...OPEN_DRAWING],
  ),
  command(I.exportImage, "Export version as image", [], [...OPEN_DRAWING]),
  command(
    I.toggleHighlights,
    "Toggle change highlights",
    [],
    [...OPEN_DRAWING],
  ),
  command(
    I.deleteCheckpoint,
    "Delete this checkpoint",
    [],
    [...WRITABLE_DRAWING],
  ),
  command(
    I.deleteAll,
    "Delete all history of this drawing",
    [],
    [...WRITABLE_DRAWING],
  ),
  command(
    I.excludeFromGit,
    "Exclude history from git",
    [],
    ["vaultOpen", "writable", "!modalOpen"],
  ),
  // command audit (S8)
  command(I.backToCurrent, "Back to current version", [], [...OPEN_DRAWING]),
  command(
    I.dismissGitNotice,
    "Dismiss the git notice",
    [],
    ["vaultOpen", "!modalOpen"],
  ),
];
