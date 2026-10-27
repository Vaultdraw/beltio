/** The gallery's grid command ids (declared in plugin.toml; the full id is `gallery.<name>`). */
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

export const galleryCommandId = (name: string) => name;

export const GALLERY_COMMAND_IDS: readonly string[] = [
  ...GALLERY_MOVES,
  "open",
  "parent",
  "close",
];
