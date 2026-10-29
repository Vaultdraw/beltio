/**
 * Writes a whole drawing over an existing one (`ctx.vault.replaceDrawing`, API 0.33.0): what a
 * re-import does (toimprove #108-#110). The drawing as it was goes into History first, so one
 * Restore brings it back; when that version cannot be saved nothing is written. Pending edits of
 * the open drawing are saved before it is read, a file changed meanwhile is not overwritten, and
 * the open tab reloads from the new file.
 */
import { editState } from "../importUpgrade/stamp";

import type { HistoryRepository } from "../history/types";
import type { VaultRepository } from "./types";

export interface ReplaceDeps {
  repository: Pick<VaultRepository, "readDrawing" | "writeDrawing">;
  history: Pick<HistoryRepository, "checkpoint">;
  handle: string;
  /** Saves pending edits when `path` is the open drawing. */
  flush(path: string): Promise<void>;
  /** Reloads the open tab when it shows `path`. */
  reload(path: string): Promise<void>;
  /** Writes a drawing that does not exist yet (resolves to its revision). */
  create(path: string, json: string): Promise<string>;
}

export interface ReplaceOptions {
  /** The History entry's name for the drawing as it was. */
  versionName: string;
  /** Only when the drawing is still exactly as the import wrote it (see `importUpgrade/stamp.ts`). */
  onlyIfUntouched?: boolean;
}

export type ReplaceResult =
  | { revision: string; created?: boolean }
  /** "changed": edited since the import; "unknown": imported before stamps, so nobody can tell. */
  | { skipped: "changed" | "unknown" };

const coded = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

export async function replaceDrawing(
  deps: ReplaceDeps,
  path: string,
  json: string,
  opts: ReplaceOptions,
): Promise<ReplaceResult> {
  await deps.flush(path).catch(() => undefined);
  let file;
  try {
    file = await deps.repository.readDrawing(deps.handle, path);
  } catch (err) {
    if ((err as { code?: string }).code === "NOT_FOUND") {
      return { revision: await deps.create(path, json), created: true };
    }
    throw err;
  }
  if (file.readOnly) {
    throw coded("READ_ONLY", "The drawing is read-only");
  }
  if (opts.onlyIfUntouched) {
    let scene;
    try {
      scene = JSON.parse(file.json);
    } catch {
      return { skipped: "changed" };
    }
    const state = editState(scene);
    if (state !== "untouched") {
      return { skipped: state === "unknown" ? "unknown" : "changed" };
    }
  }
  try {
    await deps.history.checkpoint(deps.handle, path, opts.versionName, "");
  } catch {
    throw coded(
      "NO_VERSION",
      "No history version could be saved first, so the drawing was left as it was",
    );
  }
  const out = await deps.repository.writeDrawing({
    handle: deps.handle,
    path,
    json,
    expectedRevision: file.revision,
    operationId: `replace:${path}:${Date.now()}`,
  });
  await deps.reload(path).catch(() => undefined);
  return { revision: out.revision };
}

export type TrashResult =
  | { trashed: true }
  | { skipped: "changed" | "unknown" };

/**
 * Moves a drawing to the Trash after saving it in History (`ctx.vault.trashDrawing`, API 0.35.0):
 * what a re-import does with the leftover parts of a note that got shorter (hunter A-4). With
 * `onlyIfUntouched`, only a drawing the import wrote and nobody changed since.
 */
export async function trashDrawing(
  deps: Pick<ReplaceDeps, "repository" | "history" | "handle" | "flush"> & {
    trash(path: string): Promise<void>;
  },
  path: string,
  opts: ReplaceOptions,
): Promise<TrashResult> {
  await deps.flush(path).catch(() => undefined);
  const file = await deps.repository.readDrawing(deps.handle, path);
  if (file.readOnly) {
    throw coded("READ_ONLY", "The drawing is read-only");
  }
  if (opts.onlyIfUntouched) {
    let state: ReturnType<typeof editState> = "edited";
    try {
      state = editState(JSON.parse(file.json));
    } catch {
      // unreadable: treat as changed
    }
    if (state !== "untouched") {
      return { skipped: state === "unknown" ? "unknown" : "changed" };
    }
  }
  try {
    await deps.history.checkpoint(deps.handle, path, opts.versionName, "");
  } catch {
    throw coded(
      "NO_VERSION",
      "No history version could be saved first, so the drawing was left as it was",
    );
  }
  await deps.trash(path);
  return { trashed: true };
}
