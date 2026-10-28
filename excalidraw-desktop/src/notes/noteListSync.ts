/**
 * Keeps the note list (the `[[link]]` index's input) current between full
 * scans: a create, rename or delete event updates only the paths it names, so
 * a new note links at once while the full rescan stays throttled. Only a note
 * path costs one existence probe; a folder move re-walks that folder alone;
 * drawing autosaves cost nothing.
 */
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

/**
 * Applies a batch of ops with one pass over the list (a `git checkout` that
 * touches 500 notes copies the list once, not 500 times). Returns the same
 * array when nothing changed.
 */
export const applyNoteOps = (
  list: string[],
  ops: readonly NoteListOp[],
): string[] => {
  if (ops.length <= 1) {
    return ops.length === 0 ? list : applyNoteOp(list, ops[0]);
  }
  let set: Set<string> | null = null;
  let changed = false;
  for (const op of ops) {
    set ??= new Set(list);
    if (op.kind === "note") {
      changed =
        (op.exists ? !set.has(op.path) : set.delete(op.path)) || changed;
      if (op.exists) {
        set.add(op.path);
      }
    } else {
      for (const p of [...set]) {
        if (underFolder(p, op.path)) {
          set.delete(p);
          changed = true;
        }
      }
      for (const n of op.notes) {
        changed = !set.has(n) || changed;
        set.add(n);
      }
    }
  }
  return changed ? [...set!] : list;
};

const parentOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));

/**
 * The ops a vault change needs (no work for plain file events). A path with no
 * file extension is a folder: a folder renamed, moved or deleted outside the
 * app (Finder, git) arrives as plain paths, so it is re-walked alone. A burst
 * lists each parent folder once, and a note under a re-walked folder needs no
 * listing of its own.
 */
export async function notesOpsFor(
  repository: Repo,
  handle: string,
  event: Pick<VaultChange, "paths" | "rescan">,
): Promise<NoteListOp[]> {
  const ops: NoteListOp[] = [];
  const paths = [...new Set(event.paths)].filter((p) => p !== "");
  const folders = paths.filter((p) => !NOTE_EXT.test(p) && !FILE_EXT.test(p));
  // Nested folders are covered by their outermost re-walked ancestor.
  const roots = folders.filter(
    (f) => !folders.some((o) => o !== f && underFolder(f, o)),
  );
  for (const path of roots) {
    ops.push({
      kind: "folder",
      path,
      notes: await listNotePaths(repository, handle, undefined, path),
    });
  }
  const byParent = new Map<string, string[]>();
  for (const path of paths) {
    if (!NOTE_EXT.test(path) || roots.some((r) => underFolder(path, r))) {
      continue;
    }
    const parent = parentOf(path);
    byParent.set(parent, [...(byParent.get(parent) ?? []), path]);
  }
  for (const [parent, notes] of byParent) {
    let names: ReadonlySet<string>;
    try {
      // The parent listing, not the drawing-revision probe: it knows notes too.
      names = new Set(
        (await repository.listDirectory(handle, parent)).map((e) => e.path),
      );
    } catch {
      continue;
    }
    for (const path of notes) {
      ops.push({ kind: "note", path, exists: names.has(path) });
    }
  }
  return ops;
}
