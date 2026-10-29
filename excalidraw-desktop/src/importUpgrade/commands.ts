/** The palette command of the imported-notes update (useImportUpgrade.ts binds it). */
import type { CommandDefinition } from "../commands/types";

export const UPDATE_IMPORTED_NOTES = "markdown.updateImportedNotes";
/** One drawing, whether or not it looks like an import (toimprove #110). */
export const UPDATE_THIS_NOTE = "markdown.updateThisNote";

export const IMPORT_UPGRADE_COMMANDS: CommandDefinition[] = [
  {
    id: UPDATE_IMPORTED_NOTES,
    title: "Markdown: Update imported notes to my theme and font",
    category: "Markdown",
    keys: { default: [] },
    when: ["vaultOpen", "writable"],
  },
  {
    id: UPDATE_THIS_NOTE,
    title: "Markdown: Update this note to my theme and font anyway",
    category: "Markdown",
    keys: { default: [] },
    when: ["vaultOpen", "writable", "drawingOpen"],
  },
];
