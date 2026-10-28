/**
 * Keeps the note list (the `[[link]]` index's input) current between full
 * scans: a create, rename or delete event updates only the paths it names, so
 * a new note links at once while the full rescan stays throttled. Only a note
 * path costs one existence probe; a folder move re-walks that folder alone;
 * drawing autosaves cost nothing.
 */
import { probeExists } from "../tabs/missingWatcher";

import { listNotePaths } from "./noteScan";

import type { VaultChange, VaultRepository } from "../vault/types";

const NOTE_EXT = /\.(?:md|markdown)$/i;
const FILE_EXT = /\.[A-Za-z0-9]{1,12}$/;

type Repo = Pick<VaultRepository, "listDirectory">;

/** One incremental change: a note path that exists or not, or a folder subtree. */
export type NoteListOp =
  | { kind: "note"; path: string; exists: boolean }
  | { kind: "folder"; path: string; notes: string[] };

const underFolder = (p: string, folder: string) => p.startsWith(`${folder}/`);

/** Applies one op; returns the same array when nothing changed. */
export const applyNoteOp = (list: string[], op: NoteListOp): string[] => {
  if (op.kind === "note") {
    const has = list.includes(op.path);
    if (op.exists === has) {
      return list;
    }
    return op.exists ? [...list, op.path] : list.filter((p) => p !== op.path);
  }
  const kept = list.filter((p) => !underFolder(p, op.path));
  return [...kept, ...op.notes];
};

/** The ops a vault change needs (no work for plain file events). */
export async function notesOpsFor(
  repository: Repo,
  handle: string,
  event: Pick<VaultChange, "paths" | "rescan">,
): Promise<NoteListOp[]> {
  const ops: NoteListOp[] = [];
  for (const path of new Set(event.paths)) {
    if (NOTE_EXT.test(path)) {
      let exists: boolean;
      try {
        // The parent listing, not the drawing-revision probe: it knows notes too.
        exists = await probeExists(
          { listDirectory: repository.listDirectory.bind(repository) },
          handle,
          path,
        );
      } catch {
        continue;
      }
      ops.push({ kind: "note", path, exists });
    } else if (event.rescan && path !== "" && !FILE_EXT.test(path)) {
      ops.push({
        kind: "folder",
        path,
        notes: await listNotePaths(repository, handle, undefined, path),
      });
    }
  }
  return ops;
}
