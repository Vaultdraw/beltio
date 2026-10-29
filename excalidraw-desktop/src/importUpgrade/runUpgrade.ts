/**
 * "Update imported notes": every drawing the Markdown import made with the old look gets the
 * user's page and font (upgradeScene.ts). Each file gets a history version first, so one
 * restore brings it back; a file whose version cannot be saved is left as it is. Writes use the
 * revision just read, so an edit made meanwhile wins (that file is counted as skipped).
 */
import { importFolders, inFolders, recognise, REPORT_NAME } from "./recognise";
import { hasOldLook, IMPORT_MARK, upgradeScene } from "./upgradeScene";

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
  /**
   * "Update this note anyway": only these drawings, each updated whether or not it looks like an
   * import (the user chose it).
   */
  anyway?: string[];
  onProgress?: (done: number, total: number) => void;
}

export interface UpgradeSummary {
  /** Drawings looked at. */
  scanned: number;
  /** Drawings rewritten. */
  updated: number;
  /** Imported drawings with the old look that were left alone (no version, or changed meanwhile). */
  skipped: number;
  /** Each drawing left alone that the user may want updated, and why, in plain words. */
  skippedFiles: { path: string; reason: string }[];
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

/** Why a drawing was left as it was, in the words the list shows. */
export const SKIP = {
  notRecognised:
    "Not recognised as an imported note: changed after the import, or made by hand",
  readOnly: "The file is read-only",
  unreadable: "The file could not be read",
  noVersion: "No history version could be saved first",
  changed: "It changed while updating; run the update again",
} as const;

/** The folders holding an import report: the listed ones, and for one folder its parents too. */
async function reportFolders(
  deps: UpgradeDeps,
  paths: string[],
): Promise<Set<string>> {
  const found = importFolders(paths);
  const parts = (deps.folder ?? "").split("/").filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const dir = parts.slice(0, i).join("/");
    try {
      const entries = await deps.repository.listDirectory(deps.handle, dir);
      if (entries.some((e) => e.name === REPORT_NAME)) {
        found.add(dir);
      }
    } catch {
      // unreadable parent: no report there
    }
  }
  return found;
}

/** Only these may be imports, so only these are parsed: the mark, or page mode on. */
const mayBeImport = (json: string) =>
  json.includes(IMPORT_MARK) || /"enabled":\s*true/.test(json);

export async function runImportUpgrade(
  deps: UpgradeDeps,
): Promise<UpgradeSummary> {
  const { repository, history, handle, target } = deps;
  const anyway = !!deps.anyway;
  const paths =
    deps.anyway ?? (await listDrawings(repository, handle, deps.folder ?? ""));
  const reports = anyway ? new Set<string>() : await reportFolders(deps, paths);
  const summary: UpgradeSummary = {
    scanned: 0,
    updated: 0,
    skipped: 0,
    skippedFiles: [],
    paths: [],
  };
  const skip = (path: string, reason: string) => {
    summary.skipped++;
    summary.skippedFiles.push({ path, reason });
  };
  for (const [i, path] of paths.entries()) {
    deps.onProgress?.(i, paths.length);
    summary.scanned++;
    let file;
    try {
      file = await repository.readDrawing(handle, path);
    } catch {
      if (anyway) {
        skip(path, SKIP.unreadable);
      }
      continue;
    }
    // Cheap test first: most drawings are not imports and are never parsed.
    if (!anyway && !mayBeImport(file.json)) {
      continue;
    }
    let scene;
    try {
      scene = JSON.parse(file.json);
    } catch {
      continue;
    }
    const inImport = inFolders(path, reports);
    const imported = anyway || recognise(scene, inImport) !== null;
    if (!imported) {
      // The user's own drawings stay silent; inside an imported folder, an old-looking drawing
      // the import no longer recognises is listed, with "Update this note anyway" for it.
      if (inImport && hasOldLook(scene, target, true)) {
        skip(path, SKIP.notRecognised);
      }
      continue;
    }
    const next = upgradeScene(file.json, target, true);
    if (!next) {
      continue;
    }
    if (file.readOnly) {
      skip(path, SKIP.readOnly);
      continue;
    }
    try {
      await history.checkpoint(handle, path, VERSION_NAME, "");
    } catch {
      skip(path, SKIP.noVersion);
      continue;
    }
    try {
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
      skip(path, SKIP.changed);
    }
  }
  deps.onProgress?.(paths.length, paths.length);
  return summary;
}
