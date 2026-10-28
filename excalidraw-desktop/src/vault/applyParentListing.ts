import { getParentPath as parentOf } from "./treeStore";

import type { VaultEntry } from "./types";

/**
 * The flat entry list (search, links, quick switcher) after re-reading one folder that an
 * outside change touched. `entries === null` means the folder is gone (deleted, renamed or
 * moved outside the app): everything under it goes, never an error (bug hunt BH-3). Children
 * of folders that vanished from the listing go too.
 */
export function applyParentListing(
  previous: readonly VaultEntry[],
  parent: string,
  entries: readonly VaultEntry[] | null,
): VaultEntry[] {
  if (entries === null) {
    const prefix = `${parent}/`;
    return previous.filter(
      (e) => e.path !== parent && !e.path.startsWith(prefix),
    );
  }
  const listed = new Set(entries.map((e) => e.path));
  const removedFolders = previous
    .filter(
      (e) =>
        parentOf(e.path) === parent &&
        e.kind === "folder" &&
        !listed.has(e.path),
    )
    .map((e) => `${e.path}/`);
  return [
    ...previous.filter(
      (e) =>
        parentOf(e.path) !== parent &&
        !removedFolders.some((f) => e.path.startsWith(f)),
    ),
    ...entries,
  ];
}
