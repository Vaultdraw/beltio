/**
 * Gallery grid commands. They apply only while the grid has focus
 * (`galleryFocus`); handlers are bound by GalleryView while it is open, so
 * the palette offers them only then. Rebind under `[hotkeys]`.
 */
import type { Chord, CommandDefinition } from "./types";

export const GALLERY_MOVES = [
  "left",
  "right",
  "up",
  "down",
  "first",
  "last",
  "pageUp",
  "pageDown",
] as const;
export type GalleryMove = typeof GALLERY_MOVES[number];

export const galleryCommandId = (name: string) => `gallery.${name}`;

const cmd = (
  name: string,
  title: string,
  keys: Chord[],
  repeat = false,
): CommandDefinition => ({
  id: galleryCommandId(name),
  title: `Gallery: ${title}`,
  category: "Thumbnails",
  keys: { default: keys },
  when: ["galleryFocus", "!modalOpen"],
  ...(repeat ? { repeat } : {}),
});

export const GALLERY_COMMANDS: readonly CommandDefinition[] = [
  cmd("left", "Move left", ["H", "ArrowLeft"], true),
  cmd("right", "Move right", ["L", "ArrowRight"], true),
  cmd("up", "Move up", ["K", "ArrowUp"], true),
  cmd("down", "Move down", ["J", "ArrowDown"], true),
  cmd("first", "Go to first", ["Home"]),
  cmd("last", "Go to last", ["End"]),
  cmd("pageUp", "Page up", ["PageUp"], true),
  cmd("pageDown", "Page down", ["PageDown"], true),
  cmd("open", "Open tile", ["Enter"]),
  cmd("parent", "Go to parent folder", ["Backspace"]),
  cmd("close", "Close gallery", ["Escape"]),
];

export const GALLERY_COMMAND_IDS: readonly string[] = GALLERY_COMMANDS.map(
  (c) => c.id,
);
