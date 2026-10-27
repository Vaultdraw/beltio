/**
 * Thumbnail commands (F2). Handlers are bound where the feature lives
 * (thumbnails.toggle / clearCache by the vault shell); a command without a handler
 * is simply not offered. The gallery's commands belong to the gallery plugin.
 */
import type { CommandDefinition } from "./types";

export const THUMBNAIL_COMMAND_IDS = {
  toggle: "thumbnails.toggle",
  clearCache: "thumbnails.clearCache",
} as const;

const I = THUMBNAIL_COMMAND_IDS;
const VAULT = ["vaultOpen", "!modalOpen"] as const;

const command = (
  id: string,
  title: string,
  keys: string[],
): CommandDefinition => ({
  id,
  title,
  category: "Thumbnails",
  keys: { default: keys },
  when: [...VAULT],
});

export const THUMBNAIL_COMMANDS: CommandDefinition[] = [
  command(I.toggle, "Thumbnails: Show/hide thumbnails", []),
  command(I.clearCache, "Thumbnails: Clear cache for this vault", []),
];
