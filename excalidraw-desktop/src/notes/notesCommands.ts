/**
 * Note commands: pure data, always loaded (a few hundred bytes). The handlers
 * are bound by NoteView while a note tab is shown, and `notes.active` is true
 * only then, so none of these is offered (or bound to a key) anywhere else.
 */
import type { CommandDefinition, WhenClause } from "../commands/types";

export const NOTES_COMMAND_IDS = {
  toggleEdit: "notes.toggleEdit",
  save: "notes.save",
  reload: "notes.reload",
  toggleVim: "notes.toggleVim",
  toggleLineWrap: "notes.toggleLineWrap",
  toggleLineNumbers: "notes.toggleLineNumbers",
} as const;

/** Context key true while a note tab is shown (commands/contextKeys.ts). */
export const NOTES_ACTIVE_KEY = "notes.active";

// `!drawingOpen`: a note tab and the editor never show together, and the
// clause keeps Mod+S (Save drawing) from counting as a key clash.
const WHEN: WhenClause[] = [
  "vaultOpen",
  "!drawingOpen",
  NOTES_ACTIVE_KEY,
  "!modalOpen",
];

const command = (
  id: string,
  title: string,
  keys: string[] = [],
): CommandDefinition => ({
  id,
  title: `Notes: ${title}`,
  category: "Notes",
  keys: { default: keys },
  when: WHEN,
});

export const NOTES_COMMANDS: readonly CommandDefinition[] = [
  command(NOTES_COMMAND_IDS.toggleEdit, "Toggle reading and editing", [
    "Mod+E",
  ]),
  { ...command(NOTES_COMMAND_IDS.save, "Save", ["Mod+S"]) },
  command(NOTES_COMMAND_IDS.reload, "Reload from disk"),
  command(NOTES_COMMAND_IDS.toggleVim, "Toggle Vim keys"),
  command(NOTES_COMMAND_IDS.toggleLineWrap, "Toggle line wrap"),
  command(NOTES_COMMAND_IDS.toggleLineNumbers, "Toggle line numbers"),
];
