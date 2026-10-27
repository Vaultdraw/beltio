/**
 * Types of the Obsidian vault import (src/obsidian). The orchestrator codes against the
 * plugin API 0.9.0 contract (PHASE4-PLAN.md): `ctx.folders` source and target handles,
 * `ctx.pages.buildScene`, and E1's layout through `NoteLayout`, so tests can fake each.
 */
import type {
  FolderEntry,
  NoteDoc,
  PageGeometry,
  PageRequest,
  SourceFolder,
  TargetFolder,
  TextApi,
} from "@vaultdraw/api";
import type { PageItem } from "../layout/types";
import type { ImportSettings } from "../settings";

export type { FolderEntry, SourceFolder, TargetFolder };

/** One drawing's worth of laid-out items (a long note becomes several parts). */
export interface LaidOutPart {
  items: PageItem[];
  pageCount: number;
}

/** Lays a parsed note out; the real one is E1's worker (layoutBridge.ts), tests fake it. */
export type NoteLayout = (
  doc: NoteDoc,
  signal: AbortSignal,
) => Promise<LaidOutPart[]>;

/** The slice of the plugin context the import uses. */
export interface ImportContext {
  readonly markdown: { parse(text: string): Promise<NoteDoc> };
  readonly pages: {
    geometry(request?: PageRequest): PageGeometry;
    buildScene(
      items: readonly PageItem[],
      opts: { setup?: PageRequest; pageCount: number },
    ): Promise<object>;
  };
  readonly text?: Pick<TextApi, "measure">;
  readonly fonts?: {
    ensure(families: readonly string[], text?: string): Promise<void>;
  };
}

export interface ObsidianImportOptions {
  ctx: ImportContext;
  source: SourceFolder;
  target: TargetFolder;
  settings: ImportSettings;
  signal: AbortSignal;
  /** Called before each file: "Importing 12 of 340: folder/Note". */
  onProgress(done: number, total: number, current: string): void;
  /** The layout; defaults to E1's worker layout built from `ctx`. */
  layout?: NoteLayout;
}

export interface ImportError {
  /** Source path of the file that failed. */
  path: string;
  message: string;
}

export interface ObsidianImportResult {
  /** Notes converted (a note split into parts counts once). */
  notes: number;
  /** Drawings written: note parts plus converted `.excalidraw.md` files. */
  drawings: number;
  /** Attachments copied. */
  attachments: number;
  /** Files not imported: unknown kinds, and kinds the settings turn off. */
  skipped: number;
  /** `[[links]]` whose target is not in the vault (kept as text). */
  unresolvedLinks: number;
  /** Embedded images (notes and drawings) whose file was not found. */
  missingImages: number;
  /** Images over the embed cap (4 MiB): the drawing keeps a placeholder box, the file is still copied. */
  oversizedImages: number;
  /** Images of a type a drawing cannot hold (AVIF, BMP, ICO): placeholder box, file copied. */
  unsupportedImages: number;
  errors: ImportError[];
  /** True when the signal fired: what was written stays, the rest was not started. */
  cancelled: boolean;
  /** Target path of the first drawing written, to open. */
  first?: string;
  /** Every path written in the target, in order (drawings and copies). */
  written: string[];
  ms: number;
}
