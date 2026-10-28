/**
 * Keep one side of a sync conflict. The side that loses is never deleted: its content goes to
 * the file's history first (reason "discarded-edits"), and a conflict copy that loses or
 * wins is moved to the OS trash. A copy that wins is written over the original through the
 * normal guarded save (the original's revision is checked), so a file that changed again on
 * disk meanwhile refuses with CONFLICT and nothing is lost.
 */
import type { HistoryRepository } from "../history/types";
import type { VaultRepository } from "../vault/types";

export type Keep = "original" | "copy";

export interface ResolveInput {
  repository: Pick<VaultRepository, "readDrawing" | "writeDrawing" | "trash">;
  history: Pick<HistoryRepository, "snapshotBytes">;
  handle: string;
  original: string;
  copy: string;
  keep: Keep;
}

export async function resolveConflict({
  repository,
  history,
  handle,
  original,
  copy,
  keep,
}: ResolveInput): Promise<void> {
  const [orig, other] = await Promise.all([
    repository.readDrawing(handle, original),
    repository.readDrawing(handle, copy),
  ]);
  if (keep === "original") {
    // The copy's content is kept as a version of the original, then the copy leaves the tree.
    await history.snapshotBytes(
      handle,
      original,
      "discarded-edits",
      other.revision,
      other.json,
    );
  } else {
    await history.snapshotBytes(
      handle,
      original,
      "discarded-edits",
      orig.revision,
      orig.json,
    );
    await repository.writeDrawing({
      handle,
      path: original,
      json: other.json,
      expectedRevision: orig.revision,
      operationId: `sync-keep-${Date.now().toString(36)}`,
    });
  }
  await repository.trash(handle, copy);
}

/** The counterpart of `path` among `entries` (one folder listing): its conflict copy, or its original. */
export function findCounterpart(
  path: string,
  entries: readonly {
    path: string;
    modifiedAt: number;
    sync?: string;
    conflictOf?: string;
  }[],
): { original: string; copy: string } | null {
  const self = entries.find((e) => e.path === path);
  if (self?.sync === "conflict" && self.conflictOf) {
    return { original: self.conflictOf, copy: path };
  }
  const copies = entries
    .filter((e) => e.sync === "conflict" && e.conflictOf === path)
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
  return copies[0] ? { original: path, copy: copies[0].path } : null;
}
