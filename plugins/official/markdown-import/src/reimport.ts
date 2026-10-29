/**
 * Re-import (toimprove #108-#110): an imported drawing is rebuilt from the note it came from, with
 * what the import draws today (real tables, line breaks, picture order, downloaded web pictures).
 *
 * - "Re-import this note from its Markdown": one drawing, edited or not (the user chose it).
 * - "Re-import unchanged imported notes": the vault or one folder; a drawing changed since it was
 *   imported is left alone and counted, never rewritten.
 *
 * The note is found in the Obsidian vault the user picks (once per session): its path is the
 * drawing's path without the folder the import wrote into. Every drawing written keeps the old one
 * in History first (`ctx.vault.replaceDrawing`), so Restore brings it back.
 */
import { createWebImages } from "./webImages";
import { importObsidianVault } from "./deps";
import { planImport, type PlanItem } from "./obsidian/plan";
import { readSettings } from "./settings";

import type { PluginContext, SourceFolder, TargetFolder } from "@vaultdraw/api";

export const VERSION_NAME = "Before re-importing from the note";

/** "Note (part 2).excalidraw" -> "Note.excalidraw": every part comes from the same note. */
export const firstPart = (path: string): string =>
  path.replace(/ \(part \d+\)(?=\.excalidraw$)/, "");

/**
 * The note each drawing came from: the plan item whose target is the drawing's path, or its end
 * (the import wrote into a folder of the vault, such as "Obsidian/"). The longest match wins.
 * Returns the note and the folder in front of its target.
 */
export function matchNotes(
  drawings: readonly string[],
  items: readonly PlanItem[],
): Map<string, { item: PlanItem; root: string }> {
  const notes = items.filter((i) => i.kind === "note");
  const byTarget = new Map(notes.map((i) => [i.target, i]));
  const out = new Map<string, { item: PlanItem; root: string }>();
  for (const drawing of drawings) {
    const base = firstPart(drawing);
    // Try the whole path, then drop one leading folder at a time.
    const parts = base.split("/");
    for (let k = 0; k < parts.length; k++) {
      const item = byTarget.get(parts.slice(k).join("/"));
      if (item) {
        out.set(drawing, { item, root: parts.slice(0, k).join("/") });
        break;
      }
    }
  }
  return out;
}

let picked: SourceFolder | null = null;

/** The Obsidian vault the notes came from: asked once per session. */
async function sourceOf(ctx: PluginContext): Promise<SourceFolder | null> {
  picked ??= await ctx.folders.pickSource({
    title: "Choose the Obsidian vault these notes came from",
  });
  return picked;
}

/** Every drawing in `dir` and below. */
async function drawingsIn(ctx: PluginContext, dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await ctx.vault.list(dir)) {
    if (e.kind === "folder") {
      out.push(...(await drawingsIn(ctx, e.path)));
    } else if (e.path.endsWith(".excalidraw")) {
      out.push(e.path);
    }
  }
  return out;
}

/** A target that keeps each built drawing instead of writing it. */
const captureTarget = (into: Map<string, object>): TargetFolder =>
  ({
    name: "re-import",
    kind: "vaultFolder",
    async writeDrawing(path: string, scene: object) {
      into.set(path, scene);
    },
    async copyFrom() {},
    async convertDrawing() {},
    async open() {},
  } as unknown as TargetFolder);

export interface ReimportSummary {
  written: string[];
  changed: string[];
  /** Imported before the import stamped its notes: nobody can tell if they were edited. */
  unknown: string[];
  notFound: string[];
  failed: string[];
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** Rebuilds `drawings` from their notes. `onlyUntouched`: leave changed drawings alone. */
export async function reimport(
  ctx: PluginContext,
  drawings: readonly string[],
  onlyUntouched: boolean,
): Promise<ReimportSummary | null> {
  const source = await sourceOf(ctx);
  if (!source) {
    return null;
  }
  const settings = readSettings(ctx);
  const plan = planImport(await source.list(), settings);
  const matches = matchNotes(drawings, plan.items);
  const summary: ReimportSummary = {
    written: [],
    changed: [],
    unknown: [],
    // In a vault-wide run most drawings are the user's own: only a chosen one is "not found".
    notFound: onlyUntouched ? [] : drawings.filter((d) => !matches.has(d)),
    failed: [],
  };
  // One pass per note (a note's parts are written together, or not at all).
  const notes = new Map<string, { item: PlanItem; root: string }>();
  for (const m of matches.values()) {
    notes.set(m.item.path, m);
  }
  const web = createWebImages(
    ctx.host.has("network") ? ctx.network : undefined,
  );
  let done = 0;
  for (const { item, root } of notes.values()) {
    ctx.ui.toast("Re-importing notes", {
      id: "reimport",
      detail: item.path,
      progress: { done: done++, total: notes.size },
    });
    const built = new Map<string, object>();
    try {
      await importObsidianVault({
        ctx,
        source,
        target: captureTarget(built),
        settings: { ...settings, obsidianReport: false },
        signal: new AbortController().signal,
        onProgress() {},
        web,
        only: new Set([item.path]),
      });
    } catch {
      summary.failed.push(item.path);
      continue;
    }
    let first = true;
    for (const [rel, scene] of built) {
      const path = root ? `${root}/${rel}` : rel;
      try {
        const r = await ctx.vault.replaceDrawing(path, scene, {
          versionName: VERSION_NAME,
          onlyIfUntouched: onlyUntouched,
        });
        if ("skipped" in r) {
          (r.skipped === "unknown" ? summary.unknown : summary.changed).push(
            path,
          );
          if (first) {
            break; // the first part changed: the note stays as it is
          }
        } else if (first) {
          summary.written.push(path);
        }
      } catch {
        summary.failed.push(path);
        if (first) {
          break;
        }
      }
      first = false;
    }
  }
  ctx.ui.toast(
    summary.written.length === 0
      ? "No note was re-imported"
      : `Re-imported ${plural(summary.written.length, "note", "notes")}`,
    {
      id: "reimport",
      detail:
        [
          summary.changed.length > 0
            ? `${plural(
                summary.changed.length,
                "note was",
                "notes were",
              )} changed since the import and left as ${
                summary.changed.length === 1 ? "it was" : "they were"
              }`
            : "",
          summary.unknown.length > 0
            ? `${plural(
                summary.unknown.length,
                "note",
                "notes",
              )} from an older import left as ${
                summary.unknown.length === 1 ? "it was" : "they were"
              }: edits cannot be told apart there (re-import one from its menu to update it)`
            : "",
          summary.notFound.length > 0
            ? `${plural(
                summary.notFound.length,
                "drawing has",
                "drawings have",
              )} no note in ${source.name}`
            : "",
          summary.failed.length > 0
            ? `${plural(
                summary.failed.length,
                "note",
                "notes",
              )} could not be re-imported`
            : "",
        ]
          .filter(Boolean)
          .join("; ") ||
        (summary.written.length > 0
          ? "History keeps each note as it was before"
          : undefined),
    },
  );
  return summary;
}

/** "Re-import this note from its Markdown": the drawing whose menu was used, or the open one. */
export async function reimportOne(ctx: PluginContext): Promise<void> {
  const target = ctx.menus.target();
  // A menu names its own path (a file row, or the tab that was right-clicked, which need not be
  // the active one); only a palette or key run falls back to the open drawing.
  const path = target ? target.path : ctx.workspace.activePath();
  if (!path) {
    ctx.ui.toast("Open an imported note first");
    return;
  }
  const s = await reimport(ctx, [path], false);
  if (s && s.written.length === 0 && s.notFound.length > 0) {
    ctx.ui.toast("This drawing has no note in that vault", {
      id: "reimport",
      detail: "Pick the Obsidian vault it was imported from",
      actions: [
        {
          label: "Pick again",
          run: () => {
            picked = null;
            void reimportOne(ctx);
          },
        },
      ],
    });
  }
}

/** "Re-import unchanged imported notes": a folder's (from its menu) or the whole vault's. */
export async function reimportUnchanged(ctx: PluginContext): Promise<void> {
  const target = ctx.menus.target();
  const dir = target?.kind === "folder" && target.path ? target.path : "";
  await reimport(ctx, await drawingsIn(ctx, dir), true);
}

/** Test seam: forget the picked vault. */
export const forgetSource = () => {
  picked = null;
};
