/** Extension bisect command metadata (pure data; handlers in bisectCommands.ts). */
import type { CommandDefinition } from "../commands/types";

export const BISECT_COMMAND_IDS = {
  start: "extensions.bisect.start",
  still: "extensions.bisect.still",
  gone: "extensions.bisect.gone",
  stop: "extensions.bisect.stop",
} as const;

const def = (id: string, title: string): CommandDefinition => ({
  id,
  title,
  category: "Extensions",
  keys: { default: [] },
});

export const BISECT_COMMANDS: readonly CommandDefinition[] = [
  def(
    BISECT_COMMAND_IDS.start,
    "Extensions: Find the extension causing a problem (bisect)",
  ),
  def(BISECT_COMMAND_IDS.still, "Extensions bisect: The problem still happens"),
  def(BISECT_COMMAND_IDS.gone, "Extensions bisect: The problem is gone"),
  def(BISECT_COMMAND_IDS.stop, "Extensions bisect: Stop"),
];
