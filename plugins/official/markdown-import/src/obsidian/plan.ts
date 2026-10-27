/**
 * The import plan: every file of the source sorted into a kind, with its target path. Folder
 * structure is kept; a note `a/Note.md` becomes `a/Note.excalidraw`, a drawing
 * `a/Sketch.excalidraw.md` becomes `a/Sketch.excalidraw`, an attachment keeps its path. Two
 * entries that would land on the same (case-insensitive) target name are renamed
 * `Name 2.excalidraw`, never overwritten.
 */
import type { FolderEntry } from "@vaultdraw/api";
import type { ImportSettings } from "../settings";

export type ItemKind = "note" | "excalidrawMd" | "drawing" | "attachment";

export interface PlanItem {
  kind: ItemKind;
  /** Source path. */
  path: string;
  /** Target path (drawings end in `.excalidraw`). */
  target: string;
}

export interface Plan {
  items: PlanItem[];
  /** Files not imported (kinds the settings turn off, hidden entries). */
  skipped: number;
  /** Knows every planned target name; part names and collision renames go through it too. */
  namer: Namer;
}

const NOTE = /\.(md|markdown)$/i;
const EXCALIDRAW_MD = /\.excalidraw\.md$/i;
const DRAWING = /\.excalidraw$/i;

/** True when a path has a segment that starts with a dot (never imported). */
export const hasDotSegment = (path: string): boolean =>
  path.split("/").some((s) => s.startsWith("."));

/** The kind of a source file by its name, before the settings are applied. */
export const kindOf = (path: string): ItemKind => {
  if (EXCALIDRAW_MD.test(path)) {
    return "excalidrawMd";
  }
  if (NOTE.test(path)) {
    return "note";
  }
  if (DRAWING.test(path)) {
    return "drawing";
  }
  return "attachment";
};

/** Target path of a source file: notes and `.excalidraw.md` drawings become `.excalidraw`. */
export const targetOf = (path: string, kind: ItemKind): string => {
  switch (kind) {
    case "excalidrawMd":
      return path.replace(EXCALIDRAW_MD, ".excalidraw");
    case "note":
      return path.replace(NOTE, ".excalidraw");
    default:
      return path;
  }
};

/** `a/Note.excalidraw` → `["a/Note", ".excalidraw"]`; a plain file keeps its own extension. */
export const splitExt = (path: string): [string, string] => {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
};

/** `Name.excalidraw`, `Name 2.excalidraw`, …: the first name not in `taken` (case-insensitive). */
export class Namer {
  private readonly taken = new Set<string>();

  constructor(taken: Iterable<string> = []) {
    for (const t of taken) {
      this.taken.add(t.toLowerCase());
    }
  }

  has(path: string): boolean {
    return this.taken.has(path.toLowerCase());
  }

  /** Reserves and returns a free name for `path`. */
  claim(path: string): string {
    const [stem, ext] = splitExt(path);
    let candidate = path;
    for (let n = 2; this.has(candidate); n++) {
      candidate = `${stem} ${n}${ext}`;
    }
    this.taken.add(candidate.toLowerCase());
    return candidate;
  }

  /** The next free name after a collision reported by the target itself. */
  next(path: string): string {
    this.taken.add(path.toLowerCase());
    return this.claim(path);
  }
}

/** Target path of a part: `Name.excalidraw`, `Name (part 2).excalidraw`. */
export const partPath = (target: string, part: number): string => {
  if (part <= 1) {
    return target;
  }
  const [stem, ext] = splitExt(target);
  return `${stem} (part ${part})${ext}`;
};

/** Sorts the listing into the plan. Notes first, then drawings, then attachments. */
export const planImport = (
  entries: readonly FolderEntry[],
  settings: Pick<ImportSettings, "obsidianAttachments" | "obsidianExcalidraw">,
): Plan => {
  const order: Record<ItemKind, number> = {
    note: 0,
    excalidrawMd: 1,
    drawing: 1,
    attachment: 2,
  };
  const wanted: PlanItem[] = [];
  let skipped = 0;
  for (const e of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    if (hasDotSegment(e.path)) {
      skipped++;
      continue;
    }
    const kind = kindOf(e.path);
    if (
      (kind === "excalidrawMd" && !settings.obsidianExcalidraw) ||
      (kind === "attachment" && !settings.obsidianAttachments)
    ) {
      skipped++;
      continue;
    }
    wanted.push({ kind, path: e.path, target: targetOf(e.path, kind) });
  }
  wanted.sort((a, b) => order[a.kind] - order[b.kind]);
  const namer = new Namer();
  for (const item of wanted) {
    item.target = namer.claim(item.target);
  }
  return { items: wanted, skipped, namer };
};
