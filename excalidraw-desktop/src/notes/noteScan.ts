/**
 * The vault's notes, for resolving `[[links]]`. The app's flat file index keeps
 * drawings and folders only (vault/treeStore.ts), so the notes extension walks
 * the folders itself, once a note is open: breadth first, folders in turn, no
 * work at all until then.
 */
import type { VaultRepository } from "../vault/types";

/** Vault-relative paths of every note (under `root`), found through `listDirectory`. */
export async function listNotePaths(
  repository: Pick<VaultRepository, "listDirectory">,
  handle: string,
  signal?: AbortSignal,
  root = "",
): Promise<string[]> {
  const notes: string[] = [];
  const queue = [root];
  while (queue.length > 0 && !signal?.aborted) {
    const dir = queue.shift()!;
    try {
      for (const item of await repository.listDirectory(handle, dir)) {
        if (item.kind === "folder") {
          queue.push(item.path);
        } else if (item.kind === "note") {
          notes.push(item.path);
        }
      }
    } catch {
      // a folder that moved or cannot be read is skipped
    }
  }
  return notes;
}
