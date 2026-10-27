/**
 * Obsidian vault → Vaultdraw vault. One pass over the source listing:
 *
 * | Source file            | Result                                                    |
 * | ---------------------- | --------------------------------------------------------- |
 * | `Note.md`              | `Note.excalidraw` (page-mode drawing; parts when long)    |
 * | `Sketch.excalidraw.md` | `Sketch.excalidraw` (`folders.convertDrawing`, native)    |
 * | `Sketch.excalidraw`    | copied natively                                           |
 * | anything else          | copied natively (attachments), unless the setting is off |
 *
 * The source is only read. Every write is create-only, so nothing in the target is overwritten;
 * a failing file is recorded and the import goes on. Notes come first so `first` is a note.
 */
import { LinkResolver, rewriteLinks } from "./links";
import { partPath, planImport, type PlanItem } from "./plan";

import type {
  LaidOutPart,
  ObsidianImportOptions,
  ObsidianImportResult,
} from "./types";
import type { PageItem } from "../layout/types";

/** Images above this size are not embedded (the drawing keeps a placeholder). */
export const MAX_EMBED_BYTES = 4 * 1024 * 1024;

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const codeOf = (err: unknown): string | undefined =>
  (err as { code?: string } | null)?.code;

const stem = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export async function importObsidianVault(
  opts: ObsidianImportOptions,
): Promise<ObsidianImportResult> {
  const t0 = performance.now();
  const { ctx, source, target, settings, signal } = opts;
  if (!opts.layout) {
    throw new Error("importObsidianVault needs a layout");
  }
  const layout = opts.layout;
  const entries = await source.list();
  const sizes = new Map(entries.map((e) => [e.path, e.size]));
  const plan = planImport(entries, settings);
  const resolver = new LinkResolver(plan.items);
  const setup = { size: settings.pageSize, layout: "separate" as const };

  const result: ObsidianImportResult = {
    notes: 0,
    drawings: 0,
    attachments: 0,
    skipped: plan.skipped,
    unresolvedLinks: 0,
    missingImages: 0,
    errors: [],
    cancelled: false,
    written: [],
    ms: 0,
  };
  const fail = (path: string, err: unknown) =>
    result.errors.push({ path, message: message(err) });
  const wrote = (path: string) => {
    result.written.push(path);
    result.first ??= path;
  };

  /** Create-only write; on a name that already exists, the next free name. */
  const writeUnique = async (
    path: string,
    write: (to: string) => Promise<void>,
  ): Promise<string> => {
    let to = path;
    for (let attempt = 0; ; attempt++) {
      try {
        await write(to);
        return to;
      } catch (err) {
        if (codeOf(err) !== "NAME_COLLISION" || attempt >= 20) {
          throw err;
        }
        to = plan.namer.next(to);
      }
    }
  };

  /** Fills `bytes` of image items from the vault's attachments. */
  const fillImages = async (items: PageItem[]): Promise<void> => {
    for (const item of items) {
      if (item.type !== "image" || item.bytes) {
        continue;
      }
      const hit = resolver.resolve(item.target, ["attachment"]);
      const size = hit ? sizes.get(hit.path) : undefined;
      if (!hit || size === undefined) {
        result.missingImages++;
      } else if (size <= MAX_EMBED_BYTES) {
        try {
          item.bytes = await source.readBytes(hit.path);
        } catch {
          result.missingImages++;
        }
      }
    }
  };

  const importNote = async (item: PlanItem): Promise<void> => {
    let doc = await ctx.markdown.parse(await source.readText(item.path));
    if (settings.obsidianLinks === "drawing") {
      const r = rewriteLinks(doc, resolver);
      doc = r.doc;
      result.unresolvedLinks += r.stats.unresolved;
    }
    let parts: LaidOutPart[] = await layout(doc, signal);
    if (parts.length === 0) {
      parts = [{ items: [], pageCount: 1 }];
    }
    for (const [i, part] of parts.entries()) {
      if (signal.aborted) {
        return;
      }
      await fillImages(part.items);
      const scene = await ctx.pages.buildScene(part.items, {
        setup,
        pageCount: Math.max(1, part.pageCount),
      });
      const wanted =
        i === 0 ? item.target : plan.namer.claim(partPath(item.target, i + 1));
      const to = await writeUnique(wanted, (p) =>
        target.writeDrawing(p, scene),
      );
      wrote(to);
      result.drawings++;
    }
    result.notes++;
  };

  const total = plan.items.length;
  let done = 0;
  for (const item of plan.items) {
    if (signal.aborted) {
      result.cancelled = true;
      break;
    }
    opts.onProgress(done, total, stem(item.path));
    try {
      switch (item.kind) {
        case "note":
          await importNote(item);
          break;
        case "excalidrawMd":
          wrote(
            await writeUnique(item.target, (p) =>
              target.convertDrawing(source, item.path, p),
            ),
          );
          result.drawings++;
          break;
        case "drawing":
          wrote(
            await writeUnique(item.target, (p) =>
              target.copyFrom(source, item.path, p),
            ),
          );
          result.drawings++;
          break;
        case "attachment":
          wrote(
            await writeUnique(item.target, (p) =>
              target.copyFrom(source, item.path, p),
            ),
          );
          result.attachments++;
          break;
      }
    } catch (err) {
      fail(item.path, err);
    }
    done++;
  }
  if (signal.aborted) {
    result.cancelled = true;
  }
  opts.onProgress(done, total, "");
  result.ms = performance.now() - t0;
  return result;
}
