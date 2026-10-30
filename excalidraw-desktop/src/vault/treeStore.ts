import { stripDrawingExt } from "./fileKind";
import { DEFAULT_SORT_ORDER, sortEntries, type SortOrder } from "./sortOrder";
import { joinPath, type VaultEntry, type VaultRepository } from "./types";

export { joinPath };

export type TreeNode = {
  entry: VaultEntry;
  children?: TreeNode[];
  loaded?: boolean;
  loading?: boolean;
  error?: string | null;
};

export const MAX_SEARCH_RESULTS = 100;

/** Case-insensitive filename/path substring search over an array of paths. */
export function searchPaths(entries: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  return entries.filter((entry) => entry.toLowerCase().includes(q));
}

/** Case-insensitive search over VaultEntry items, matching either path or name. */
export function searchEntries(
  entries: VaultEntry[],
  query: string,
): VaultEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  return entries.filter(
    (entry) =>
      entry.path.toLowerCase().includes(q) ||
      entry.name.toLowerCase().includes(q),
  );
}

/** Duplicate naming: "a.excalidraw" -> "a copy.excalidraw", "a copy" -> "a copy 2". */
export function duplicateName(path: string): string {
  const slash = path.lastIndexOf("/");
  const parent = slash >= 0 ? path.slice(0, slash) : "";
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  const base = file.endsWith(".excalidraw")
    ? file.slice(0, -".excalidraw".length)
    : file;
  const copyBase = / copy( \d+)?$/.test(base)
    ? base.replace(/ copy( \d+)?$/, (m) =>
        m === " copy" ? " copy 2" : ` copy ${Number(m.split(" ")[2]) + 1}`,
      )
    : `${base} copy`;
  return joinPath(parent, `${copyBase}.excalidraw`);
}

export function getParentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

/**
 * Where a folder path ends up after the folder `from` (or an ancestor) is
 * moved to `to`; `to === null` means it was removed (null result). Paths
 * outside `from` are returned unchanged.
 */
export function rebaseFolderPath(
  path: string,
  from: string,
  to: string | null,
): string | null {
  if (path !== from && !path.startsWith(`${from}/`)) {
    return path;
  }
  return to === null ? null : to + path.slice(from.length);
}

export function getBaseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

export function getCleanDrawingName(name: string): string {
  let clean = name.trim();
  if (clean.toLowerCase().endsWith(".excalidraw")) {
    clean = clean.slice(0, -".excalidraw".length);
  }
  return clean;
}

/** Same list as paths.rs `is_windows_reserved_name`; the contract table entry_names.json pins both. */
const WINDOWS_DEVICE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

export function validateEntryName(
  name: string,
  kind: "folder" | "drawing",
): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, error: "Name cannot be empty" };
  }
  // The native backend refuses a name over 255 bytes (UTF-8), so count bytes, not characters.
  if (new TextEncoder().encode(trimmed).length > 255) {
    return {
      valid: false,
      error:
        "Name is too long (255 bytes at most; emoji and accented letters take more than one)",
    };
  }
  if (/[\\/:*?"<>|]/.test(trimmed)) {
    return {
      valid: false,
      error: 'Name cannot contain slashes or any of : * ? " < > |',
    };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) {
    return { valid: false, error: "Name cannot contain line breaks or tabs" };
  }
  if (WINDOWS_DEVICE_NAMES.has(trimmed.split(".")[0].toUpperCase())) {
    return {
      valid: false,
      error: "Name is a reserved system name (Windows cannot open it)",
    };
  }
  if (kind === "folder" && trimmed.endsWith(".")) {
    return { valid: false, error: "Folder names cannot end with a dot" };
  }
  if (trimmed === "." || trimmed === "..") {
    return { valid: false, error: "Name cannot be '.' or '..'" };
  }
  if (trimmed.toLowerCase() === ".excalidraw-vault") {
    return { valid: false, error: "Name is reserved by the application" };
  }
  // The core refuses these on create and move (fsops reject_hidden); say so before the dialog closes.
  if (trimmed.startsWith(".")) {
    return {
      valid: false,
      error: "Names starting with a dot are reserved and never listed",
    };
  }
  if (kind === "folder" && trimmed.toLowerCase().endsWith(".excalidraw")) {
    return {
      valid: false,
      error: "Folder names should not end in .excalidraw",
    };
  }
  return { valid: true };
}

export function isMoveAllowed(
  sourcePath: string,
  targetParentPath: string,
): { allowed: boolean; reason?: string } {
  if (sourcePath === "") {
    return { allowed: false, reason: "Cannot move vault root" };
  }
  if (sourcePath === targetParentPath) {
    return { allowed: false, reason: "Cannot move entry into itself" };
  }
  const prefix = `${sourcePath}/`;
  if (targetParentPath.startsWith(prefix)) {
    return {
      allowed: false,
      reason: "Cannot move a folder into its own subfolder",
    };
  }
  const currentParent = getParentPath(sourcePath);
  if (currentParent === targetParentPath) {
    return { allowed: false, reason: "Item is already in this folder" };
  }
  return { allowed: true };
}

/**
 * The folder a tree row accepts drops for: a folder row is its own target,
 * a drawing row drops into the folder that contains it (VS Code / Obsidian).
 */
export function resolveDropFolder(
  rowPath: string,
  rowKind: "folder" | "drawing",
): string {
  return rowKind === "folder" ? rowPath : getParentPath(rowPath);
}

/** The same fold the backend uses to decide two names clash: capitals and accent spelling. */
export const foldName = (n: string): string =>
  n.normalize("NFC").toLowerCase().normalize("NFC");

/**
 * Drop rules for dragging `source` into `targetFolder` ("" is the vault root).
 * `existingNames` are the names already known in the target folder; a clash
 * is refused up front (the backend refuses it too, this only explains why).
 */
export function checkTreeDrop(
  source: Pick<VaultEntry, "path" | "name" | "kind">,
  targetFolder: string,
  options: { readOnly?: boolean; existingNames?: Iterable<string> } = {},
): { allowed: boolean; reason?: string } {
  if (options.readOnly) {
    return { allowed: false, reason: "Vault is read-only" };
  }
  const base = isMoveAllowed(source.path, targetFolder);
  if (!base.allowed) {
    return base;
  }
  if (options.existingNames) {
    for (const name of options.existingNames) {
      if (foldName(name) === foldName(source.name)) {
        const where = targetFolder
          ? `"${getBaseName(targetFolder)}"`
          : "the vault root";
        return {
          allowed: false,
          reason:
            name === source.name
              ? `"${stripDrawingExt(source.name)}" already exists in ${where}`
              : `"${stripDrawingExt(
                  name,
                )}" already exists in ${where} (names that differ only in capitals count as the same)`,
        };
      }
    }
  }
  return { allowed: true };
}

/**
 * Crawls vault directory metadata recursively for background search indexing.
 * Cancellable via AbortSignal. `pause` runs before each folder after the
 * first: background callers pass one that waits for user input to go quiet,
 * so the walk never competes with a click or a key press.
 */
export async function scanVaultMetadata(
  repository: VaultRepository,
  handle: string,
  signal?: AbortSignal,
  onProgress?: (entries: VaultEntry[]) => void,
  pause?: () => Promise<void>,
): Promise<VaultEntry[]> {
  const all: VaultEntry[] = [];
  const queue: string[] = [""];

  while (queue.length > 0) {
    if (signal?.aborted) {
      break;
    }
    const dir = queue.shift()!;
    if (pause && dir !== "") {
      await pause();
      if (signal?.aborted) {
        break;
      }
    }
    try {
      const items = await repository.listDirectory(handle, dir);
      for (const item of items) {
        if (signal?.aborted) {
          break;
        }
        // Notes are not drawings: the flat index (search, switcher) keeps drawings and folders.
        if (item.kind !== "note") {
          all.push(item);
        }
        if (item.kind === "folder") {
          queue.push(item.path);
        }
      }
      if (!signal?.aborted) {
        onProgress?.(all);
      }
    } catch {
      // ignore unreadable/moved directories during background scan
    }
  }

  if (signal?.aborted) {
    return [];
  }

  return all;
}

/** Default spacing between partial-scan snapshots handed to React state. */
export const SCAN_PROGRESS_INTERVAL_MS = 300;

/**
 * Coalesces scan progress: `push` remembers the latest (still growing) list
 * and emits one snapshot copy per `intervalMs` (trailing). `cancel` drops a
 * pending emit, so the caller's final set is the last update.
 */
export function createProgressThrottle(
  emit: (snapshot: VaultEntry[]) => void,
  intervalMs = SCAN_PROGRESS_INTERVAL_MS,
) {
  let latest: VaultEntry[] | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    push(list: VaultEntry[]) {
      latest = list;
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          if (latest) {
            emit(latest.slice());
          }
        }, intervalMs);
      }
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      latest = null;
    },
  };
}

/**
 * Builds a hierarchical tree node from a map of directory entries.
 */
export function buildTree(
  directoryMap: Map<string, VaultEntry[]>,
  currentPath = "",
  sort: SortOrder = DEFAULT_SORT_ORDER,
): TreeNode[] {
  const entries = sortEntries(directoryMap.get(currentPath) ?? [], sort);
  return entries.map((entry) => {
    if (entry.kind === "folder") {
      const children = directoryMap.has(entry.path)
        ? buildTree(directoryMap, entry.path, sort)
        : undefined;
      return {
        entry,
        children,
        loaded: directoryMap.has(entry.path),
      };
    }
    return {
      entry,
    };
  });
}
