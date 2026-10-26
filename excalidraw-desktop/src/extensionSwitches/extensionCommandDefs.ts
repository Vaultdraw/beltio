/**
 * Command metadata for the built-in extensions (pure data; the handlers are in
 * extensionCommands.ts): one toggle per extension, rebindable in `[hotkeys]`,
 * and "Restore defaults".
 */
import { BISECT_COMMANDS } from "./bisectCommandDefs";
import { BUILTIN_EXTENSIONS, type ExtensionId } from "./registry";

import type { CommandDefinition } from "../commands/types";

export const extensionToggleCommandId = (id: ExtensionId) =>
  `extensions.toggle.${id}`;
export const EXTENSIONS_DEFAULTS_COMMAND_ID = "extensions.defaults";

export const EXTENSION_COMMANDS: readonly CommandDefinition[] = [
  ...BUILTIN_EXTENSIONS.map(
    (e): CommandDefinition => ({
      id: extensionToggleCommandId(e.id),
      title: `Extensions: Toggle ${e.title}`,
      category: "Extensions",
      keys: { default: [] },
    }),
  ),
  {
    id: EXTENSIONS_DEFAULTS_COMMAND_ID,
    title: "Extensions: Restore defaults",
    category: "Extensions",
    keys: { default: [] },
  },
  ...BISECT_COMMANDS,
];
