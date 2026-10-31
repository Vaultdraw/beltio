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
  bold: "notes.bold",
  italic: "notes.italic",
  find: "notes.find",
} as const;

/** Context key true while a note tab is shown (commands/contextKeys.ts). */
export const NOTES_ACTIVE_KEY = "notes.active";

/** Context key true while the shown note is in editing mode. */
export const NOTES_EDITING_KEY = "notes.editing";

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

const editing = (
  id: string,
  title: string,
  keys: string[],
): CommandDefinition => ({
  ...command(id, title, keys),
  when: [...WHEN, NOTES_EDITING_KEY],
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
  // Obsidian's editing keys (toimprove 280); only while the note is being edited.
  editing(NOTES_COMMAND_IDS.bold, "Bold", ["Mod+B"]),
  editing(NOTES_COMMAND_IDS.italic, "Italic", ["Mod+I"]),
  editing(NOTES_COMMAND_IDS.find, "Find in note", ["Mod+F"]),
];
