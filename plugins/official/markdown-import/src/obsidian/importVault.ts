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
import { looksLike } from "../../../../../sdk/api/shared/sceneRules";

import { createWebImages } from "../webImages";

import { parseOptions } from "../settings";

import { LinkResolver, rewriteLinks } from "./links";
import { partPath, planImport, type PlanItem } from "./plan";

import { buildReport, REPORT_PATH } from "./report";

import type {
  ImageIssue,
  LaidOutPart,
  ObsidianImportOptions,
  ObsidianImportResult,
} from "./types";
import type { PageItem } from "../layout/types";

/** Images above this size are not embedded (the drawing keeps a placeholder). */
export const MAX_EMBED_BYTES = 4 * 1024 * 1024;

/** The picture type the bytes really are, or null. */
export const sniffMime = (bytes: Uint8Array): string | null =>
  [...EMBEDDABLE].find((m) => looksLike(m, bytes)) ?? null;

/** The picture types a drawing can hold (the scene API's list). */
const EMBEDDABLE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

/** Native copies in flight at once: enough to hide the call latency, few enough to keep the disk calm. */
export const COPY_CONCURRENCY = 4;

/** Longest stretch of import work before the loop gives the main thread back. */
const SLICE_MS = 12;

/** A turn of the event loop: queued input, timers and paints run before the import goes on. */
const yieldToInput = (): Promise<void> =>
  new Promise((resolve) => {
    // A message task, not setTimeout: nested timers are clamped to 4 ms.
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(0);
  });

/** Most rows the import report lists per kind of problem. */
export const MAX_REPORT_ROWS = 2000;

const EMPTY_PART: LaidOutPart = { items: [], pageCount: 1 };

const REMOTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

const dirOf = (path: string): string =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const codeOf = (err: unknown): string | undefined =>
  (err as { code?: string } | null)?.code;

const stem = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export async function importObsidianVault(
  opts: ObsidianImportOptions,
): Promise<ObsidianImportResult> {
  const t0 = performance.now();
  const { ctx, source, settings, signal } = opts;
  let target = opts.target;
  let moves = 0;
  let writes = 0;
  if (!opts.layout) {
    throw new Error("importObsidianVault needs a layout");
  }
  const layout = opts.layout;
  const entries = await source.list();
  const sizes = new Map(entries.map((e) => [e.path, e.size]));
  const plan = planImport(entries, settings);
  // Images resolve against every file of the vault, also when copying attachments is switched off.
  const resolver = new LinkResolver(
    settings.obsidianAttachments
      ? plan.items
      : planImport(entries, { ...settings, obsidianAttachments: true }).items,
  );
  const setup = { size: settings.pageSize, layout: "separate" as const };

  const result: ObsidianImportResult = {
    notes: 0,
    drawings: 0,
    attachments: 0,
    skipped: plan.skipped,
    unresolvedLinks: 0,
    missingImages: 0,
    oversizedImages: 0,
    unsupportedImages: 0,
    imageIssues: [],
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

  /** Notes the report lists are capped: a vault with thousands of missing images must not grow the list without bound. */
  const noteIssue = (
    note: string,
    image: string,
    reason: ImageIssue["reason"],
  ) => {
    result[
      reason === "oversized"
        ? "oversizedImages"
        : reason === "unsupported"
        ? "unsupportedImages"
        : "missingImages"
    ]++;
    if (result.imageIssues.length < MAX_REPORT_ROWS) {
      result.imageIssues.push({ note, image, reason });
    }
  };

  /** Create-only write; on a name that already exists, the next free name. */
  const writeUnique = async (
    path: string,
    write: (to: string) => Promise<void>,
  ): Promise<string> => {
    let to = path;
    for (let attempt = 0; ; attempt++) {
      const used = target;
      try {
        await write(to);
        writes++;
        return to;
      } catch (err) {
        if (codeOf(err) !== "NAME_COLLISION" || attempt >= 20) {
          throw err;
        }
        // The folder already holds an earlier import: start a fresh folder, so
        // the rewritten links resolve inside this import, not the old one.
        if (target !== used) {
          attempt = -1; // a parallel write already moved to the fresh folder
          to = path;
          continue;
        }
        if (writes === 0 && opts.nextTarget && moves < 20) {
          const fresh = await opts.nextTarget(++moves + 1);
          if (fresh) {
            target = fresh;
            result.target = fresh;
            attempt = -1;
            to = path;
            continue;
          }
          moves = 20;
        }
        to = plan.namer.next(to);
      }
    }
  };

  /** Says in the placeholder box why the picture is not there. */
  const label = (item: PageItem & { type: "image" }, why: string): void => {
    item.alt = `${why}: ${item.alt || item.target}`;
  };

  /** Fills `bytes` of image items from the vault's attachments. */
  const fillImages = async (
    items: PageItem[],
    fromDir: string,
    note: string,
  ): Promise<void> => {
    const remote: PageItem[] = [];
    for (const item of items) {
      if (item.type !== "image" || item.bytes) {
        continue;
      }
      if (REMOTE.test(item.target)) {
        remote.push(item); // downloaded below only if the user allows it
        continue;
      }
      const written = item.target.split(/[?#]/)[0];
      const hit = resolver.resolve(written, ["attachment"], fromDir);
      const size = hit ? sizes.get(hit.path) : undefined;
      if (!hit || size === undefined) {
        // An unsupported type that is also missing is reported as missing: that is the first problem.
        noteIssue(note, item.target, "missing");
        label(item, "Image not found");
      } else if (!EMBEDDABLE.has(item.mimeType)) {
        noteIssue(note, item.target, "unsupported");
        label(item, "Image type a drawing cannot hold");
      } else if (size > MAX_EMBED_BYTES) {
        noteIssue(note, item.target, "oversized");
        label(item, "Image over 4 MB");
      } else {
        try {
          const bytes = await source.readBytes(hit.path);
          // The file's own type decides, not its name: a WebP saved as `.png` is common, and a
          // picture the drawing refuses would fail the whole note.
          const mime = sniffMime(bytes);
          if (!mime) {
            noteIssue(note, item.target, "unsupported");
            label(item, "Not a picture a drawing can hold");
          } else {
            item.mimeType = mime;
            item.bytes = bytes;
          }
        } catch {
          noteIssue(note, item.target, "missing");
          label(item, "Image not found");
        }
      }
    }
    if (remote.length > 0) {
      await (opts.web ?? createWebImages(undefined)).fill(remote, signal);
    }
  };

  /**
   * Builds one part's scene and writes it. The scene (with its base64 images) lives only inside
   * this call, and the caller drops the part (and its image bytes) once it is written.
   */
  const writePart = async (
    part: LaidOutPart,
    wanted: string,
  ): Promise<string> => {
    const scene = await ctx.pages.buildScene(part.items, {
      setup,
      pageCount: Math.max(1, part.pageCount),
    });
    return writeUnique(wanted, (p) => target.writeDrawing(p, scene));
  };

  const importNote = async (item: PlanItem): Promise<void> => {
    let doc = await ctx.markdown.parse(
      await source.readText(item.path),
      parseOptions(settings),
    );
    if (signal.aborted) {
      return;
    }
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
      await fillImages(part.items, dirOf(item.path), item.path);
      const wanted =
        i === 0 ? item.target : plan.namer.claim(partPath(item.target, i + 1));
      const to = await writePart(part, wanted);
      wrote(to);
      result.drawings++;
      parts[i] = EMPTY_PART; // this part's items are done: let the laid-out data go
    }
    result.notes++;
  };

  /** One copy-kind item (a drawing conversion, a drawing, an attachment): the native side does the work. */
  const copyItem = async (item: PlanItem): Promise<() => void> => {
    const to = await writeUnique(item.target, (p) =>
      item.kind === "excalidrawMd"
        ? target.convertDrawing(source, item.path, p)
        : target.copyFrom(source, item.path, p),
    );
    // Recorded in plan order by the caller, so `written` and `first` do not depend on timing.
    return () => {
      wrote(to);
      if (item.kind === "attachment") {
        result.attachments++;
      } else {
        result.drawings++;
      }
    };
  };

  const total = plan.items.length;
  let done = 0;
  let sliceStart = performance.now();
  for (let i = 0; i < total; ) {
    if (signal.aborted) {
      result.cancelled = true;
      break;
    }
    // Let input and painting in: never more than ~SLICE_MS of work between two turns of the loop.
    if (performance.now() - sliceStart > SLICE_MS) {
      await yieldToInput();
      sliceStart = performance.now();
      continue;
    }
    const item = plan.items[i];
    opts.onProgress(done, total, stem(item.path));
    if (item.kind === "note") {
      try {
        await importNote(item);
      } catch (err) {
        fail(item.path, err);
      }
      i++;
      done++;
      continue;
    }
    // A run of copy items goes out COPY_CONCURRENCY at a time (each is a native call).
    const batch = plan.items
      .slice(i, i + COPY_CONCURRENCY)
      .filter((b) => b.kind !== "note");
    const outcomes = await Promise.allSettled(batch.map(copyItem));
    outcomes.forEach((o, k) => {
      if (o.status === "fulfilled") {
        o.value();
      } else {
        fail(batch[k].path, o.reason);
      }
    });
    i += batch.length;
    done += batch.length;
  }
  if (signal.aborted) {
    result.cancelled = true;
  }
  opts.onProgress(done, total, "");
  const report = settings.obsidianReport
    ? buildReport(source.name, result)
    : null;
  if (report) {
    try {
      const doc = await ctx.markdown.parse(report);
      const parts = await layout(doc, signal);
      const to = await writePart(parts[0] ?? EMPTY_PART, REPORT_PATH);
      result.report = to;
    } catch (err) {
      fail(REPORT_PATH, err);
    }
  }
  result.ms = performance.now() - t0;
  return result;
}
