/** The palette command of the imported-notes update (useImportUpgrade.ts binds it). */
import type { CommandDefinition } from "../commands/types";

export const UPDATE_IMPORTED_NOTES = "markdown.updateImportedNotes";

export const IMPORT_UPGRADE_COMMANDS: CommandDefinition[] = [
  {
    id: UPDATE_IMPORTED_NOTES,
    title: "Markdown: Update imported notes to my theme and font",
    category: "Markdown",
    keys: { default: [] },
    when: ["vaultOpen", "writable"],
  },
];
