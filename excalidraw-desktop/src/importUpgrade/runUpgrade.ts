/**
 * "Update imported notes": every drawing the Markdown import made with the old look gets the
 * user's page and font (upgradeScene.ts). Each file gets a history version first, so one
 * restore brings it back; a file whose version cannot be saved is left as it is. Writes use the
 * revision just read, so an edit made meanwhile wins (that file is counted as skipped).
 */
import { IMPORT_MARK, upgradeScene } from "./upgradeScene";

import type { UpgradeTarget } from "./upgradeScene";
import type { HistoryRepository } from "../history/types";
import type { VaultRepository } from "../vault/types";

export interface UpgradeDeps {
  repository: Pick<
    VaultRepository,
    "listDirectory" | "readDrawing" | "writeDrawing"
  >;
  history: Pick<HistoryRepository, "checkpoint">;
  handle: string;
  target: UpgradeTarget;
  /** Only this folder and its subfolders (vault-relative); the whole vault when absent. */
  folder?: string;
  onProgress?: (done: number, total: number) => void;
}

export interface UpgradeSummary {
  /** Drawings looked at. */
  scanned: number;
  /** Drawings rewritten. */
  updated: number;
  /** Imported drawings with the old look that were left alone (no version, or changed meanwhile). */
  skipped: number;
  /** Paths rewritten, for open tabs to reload. */
  paths: string[];
}

/** Every drawing path in the vault, depth first. */
export async function listDrawings(
  repository: UpgradeDeps["repository"],
  handle: string,
  dir = "",
): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await repository.listDirectory(handle, dir)) {
    if (entry.kind === "folder") {
      out.push(...(await listDrawings(repository, handle, entry.path)));
    } else if (entry.kind === "drawing") {
      out.push(entry.path);
    }
  }
  return out;
}

const VERSION_NAME = "Before the imported note took your theme and font";

export async function runImportUpgrade(
  deps: UpgradeDeps,
): Promise<UpgradeSummary> {
  const { repository, history, handle, target } = deps;
  const paths = await listDrawings(repository, handle, deps.folder ?? "");
  const summary: UpgradeSummary = {
    scanned: 0,
    updated: 0,
    skipped: 0,
    paths: [],
  };
  for (const [i, path] of paths.entries()) {
    deps.onProgress?.(i, paths.length);
    summary.scanned++;
    let file;
    try {
      file = await repository.readDrawing(handle, path);
    } catch {
      continue;
    }
    // Cheap test first: most drawings are not imports and are never parsed.
    if (file.readOnly || !file.json.includes(IMPORT_MARK)) {
      continue;
    }
    const next = upgradeScene(file.json, target);
    if (!next) {
      continue;
    }
    try {
      await history.checkpoint(handle, path, VERSION_NAME, "");
      await repository.writeDrawing({
        handle,
        path,
        json: next.json,
        expectedRevision: file.revision,
        operationId: `import-upgrade:${path}`,
      });
      summary.updated++;
      summary.paths.push(path);
    } catch {
      summary.skipped++;
    }
  }
  deps.onProgress?.(paths.length, paths.length);
  return summary;
}
