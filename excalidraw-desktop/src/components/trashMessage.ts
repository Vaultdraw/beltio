import type { FolderCount } from "../vault/types";

/** Confirmation text for moving a folder to the Trash; names how many files it holds once counted. */
export const folderTrashMessage = (
  name: string,
  count: FolderCount | null,
): string => {
  const restore = "You can restore it from the system Trash.";
  if (!count || count.count === 0) {
    return `Move the folder \u201c${name}\u201d to the Trash? ${restore}`;
  }
  const items = count.capped
    ? "1,000+ items"
    : `${count.count} ${count.count === 1 ? "item" : "items"}`;
  return `Move \u201c${name}\u201d and its ${items} to the Trash? ${restore}`;
};
