/**
 * Names that sync services create: conflict copies, iCloud placeholders, temporary files.
 * Twin of `vaultdraw-core/src/sync_names.rs` (shared fixtures: `fixtures/syncnames.json`).
 * The native listing already flags entries; this twin serves the in-browser test vault and
 * the compare command (finding a file's conflict copies from a folder listing).
 */
import { fileKind } from "./fileKind";

const EXT_LEN = { drawing: 11, excalidrawMd: 14, note: 3 } as const;

const known = (name: string): boolean => fileKind(name) !== "other";

const endsWithCi = (name: string, ext: string): boolean =>
  name.length >= ext.length &&
  name.slice(name.length - ext.length).toLowerCase() === ext;

export const isSyncTempName = (name: string): boolean =>
  name.startsWith("~$") ||
  name.startsWith(".~lock.") ||
  name.startsWith(".syncthing.") ||
  name.startsWith(".dropbox") ||
  [".tmp", ".temp", ".part", ".partial", ".crdownload", ".download"].some((e) =>
    endsWithCi(name, e),
  ) ||
  /\.sb-[A-Za-z0-9-]+$/.test(name);

export const placeholderRealName = (name: string): string | null => {
  if (!name.startsWith(".") || !name.endsWith(".icloud")) {
    return null;
  }
  const inner = name.slice(1, name.length - ".icloud".length);
  return inner && known(inner) ? inner : null;
};

const dropboxOriginal = (name: string): string | null => {
  const at = name.toLowerCase().indexOf("conflicted copy");
  if (at < 0) {
    return null;
  }
  const open = name.slice(0, at).lastIndexOf(" (");
  const closeRel = name.slice(at).indexOf(")");
  if (open <= 0 || closeRel < 0) {
    return null;
  }
  let rest = name.slice(at + closeRel + 1);
  const repeat = /^ \(\d+\)/.exec(rest);
  if (repeat) {
    rest = rest.slice(repeat[0].length);
  }
  const original = name.slice(0, open) + rest;
  return known(original) ? original : null;
};

const syncthingOriginal = (name: string): string | null => {
  const m = /^(.+?)\.sync-conflict-\d{8}-\d{6}(?:-[^.]*)?(\..*)?$/.exec(name);
  if (!m) {
    return null;
  }
  const original = m[1] + (m[2] ?? "");
  return known(original) ? original : null;
};

export const conflictOriginal = (name: string): string | null =>
  dropboxOriginal(name) ?? syncthingOriginal(name);

/** `Plan 2.ext` -> `Plan.ext`; the caller checks the original exists beside it. */
export const numberedCopyOriginal = (name: string): string | null => {
  const kind = fileKind(name);
  if (kind === "other") {
    return null;
  }
  const extLen = EXT_LEN[kind];
  if (name.length <= extLen) {
    return null;
  }
  const stem = name.slice(0, name.length - extLen);
  const m = /^(.+) (\d+)$/.exec(stem);
  if (!m) {
    return null;
  }
  const n = Number(m[2]);
  return n >= 2 && n <= 99 ? m[1] + name.slice(name.length - extLen) : null;
};

/** iCloud Drive keeps its folders under `~/Library/Mobile Documents/` (Obsidian's iCloud vaults too). */
export const inICloudDrive = (root: string): boolean =>
  root.split("\\").join("/").includes("/Library/Mobile Documents/");

/**
 * Whether `Plan 2.ext` beside `Plan.ext` is an iCloud conflict copy: only in a folder iCloud
 * manages (the vault is in iCloud Drive, or the folder holds an iCloud placeholder). Elsewhere it
 * is the next free name the app and Obsidian give ("Untitled 2", "Plan copy 2"). Twin of
 * `numbered_copies_are_conflicts` in sync_names.rs.
 */
export const numberedCopiesAreConflicts = (
  root: string,
  folderHasPlaceholder: boolean,
): boolean => folderHasPlaceholder || inICloudDrive(root);
