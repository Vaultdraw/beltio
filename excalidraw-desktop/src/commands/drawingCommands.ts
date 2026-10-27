/**
 * Per-drawing "Open drawing: <name>" commands. They are not in the static
 * registry: each `[hotkeys]` entry whose id is `drawing.open:<vault-relative
 * path>` makes one (so the key lives in config.toml like every other).
 */
import { stripDrawingExt } from "../vault/fileKind";

import type { CommandDefinition, HotkeyOverrides } from "./types";

export const DRAWING_OPEN_PREFIX = "drawing.open:";

export const drawingOpenCommandId = (path: string): string =>
  `${DRAWING_OPEN_PREFIX}${path}`;

/** The vault-relative path of a `drawing.open:<path>` id; null for any other id. */
export const parseDrawingOpenCommandId = (id: string): string | null =>
  id.startsWith(DRAWING_OPEN_PREFIX) && id.length > DRAWING_OPEN_PREFIX.length
    ? id.slice(DRAWING_OPEN_PREFIX.length)
    : null;

/** "Graphs/BFS.excalidraw" -> "BFS". */
export const drawingDisplayName = (path: string): string =>
  stripDrawingExt(path.split("/").pop() ?? path);

export const makeDrawingOpenCommand = (path: string): CommandDefinition => ({
  id: drawingOpenCommandId(path),
  title: `Open drawing: ${drawingDisplayName(path)}`,
  category: "Links",
  keys: { default: [] },
  when: ["vaultOpen", "!modalOpen"],
});

/** One command per drawing bound in `[hotkeys]`, in id order. */
export const drawingOpenCommands = (
  overrides: HotkeyOverrides,
): CommandDefinition[] =>
  Object.keys(overrides)
    .filter((id) => parseDrawingOpenCommandId(id) !== null)
    .sort()
    .map((id) => makeDrawingOpenCommand(parseDrawingOpenCommandId(id)!));
