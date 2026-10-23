/**
 * CSS snippet commands. "Open folder" and "Reload" are static; each snippet
 * gets a "Toggle <name>" command with the id `snippets.toggle:<name>`. Those
 * are registered once the folder has been listed, and one bound in
 * `[hotkeys]` exists even before (like `drawing.open:<path>`), so its key
 * works from the first keystroke. Handlers live in boot.ts.
 */
import type { CommandDefinition, HotkeyOverrides } from "../commands/types";

export const SNIPPET_COMMAND_IDS = {
  openFolder: "snippets.openFolder",
  reload: "snippets.reload",
} as const;

export const SNIPPET_TOGGLE_PREFIX = "snippets.toggle:";

export const SNIPPET_COMMANDS: readonly CommandDefinition[] = [
  {
    id: SNIPPET_COMMAND_IDS.openFolder,
    title: "CSS snippets: Open folder",
    category: "Appearance",
    keys: { default: [] },
  },
  {
    id: SNIPPET_COMMAND_IDS.reload,
    title: "CSS snippets: Reload",
    category: "Appearance",
    keys: { default: [] },
  },
];

export const snippetToggleCommandId = (name: string): string =>
  `${SNIPPET_TOGGLE_PREFIX}${name}`;

/** The snippet name of a `snippets.toggle:<name>` id; null for any other id. */
export const parseSnippetToggleCommandId = (id: string): string | null =>
  id.startsWith(SNIPPET_TOGGLE_PREFIX) &&
  id.length > SNIPPET_TOGGLE_PREFIX.length
    ? id.slice(SNIPPET_TOGGLE_PREFIX.length)
    : null;

export const makeSnippetToggleCommand = (name: string): CommandDefinition => ({
  id: snippetToggleCommandId(name),
  title: `CSS snippets: Toggle ${name}`,
  category: "Appearance",
  keys: { default: [] },
});

/** One toggle per snippet bound in `[hotkeys]` (in id order). */
export const boundSnippetToggleCommands = (
  overrides: HotkeyOverrides,
): CommandDefinition[] =>
  Object.keys(overrides)
    .filter((id) => parseSnippetToggleCommandId(id) !== null)
    .sort()
    .map((id) => makeSnippetToggleCommand(parseSnippetToggleCommandId(id)!));
