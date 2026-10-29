/**
 * Exports one drawing at a time, off the save path: a save only starts a timer; after the debounce
 * the drawing waits in a queue that is worked on idle ticks, one export per tick.
 */
import { exportPath, hasSkipTag, isExcluded, folderProblem } from "./paths";

import type { PluginContext } from "@vaultdraw/api";
import type { Config } from "./config";

type Idle = (run: () => void) => void;

const defaultIdle: Idle = (run) => {
  const w = globalThis as {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  };
  if (w.requestIdleCallback) {
    w.requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 0);
  }
};

const codeOf = (e: unknown): string =>
  (e as { code?: string } | null)?.code ?? "";

/** The file a CONFLICT message names (it starts with the path). */
const conflictPath = (e: unknown): string | null => {
  const m = /^(.+?) already exists/.exec((e as Error)?.message ?? "");
  return m ? m[1] : null;
};

export interface Exporter {
  /** A save happened: export after the debounce (restarts the wait). */
  schedule(path: string): void;
  /** Exports now, skipping the debounce and the queue; false when nothing was written. */
  exportNow(path: string, force: boolean): Promise<boolean>;
  /** Drops what is waiting. */
  clear(): void;
  /** Queued or running. */
  busy(): boolean;
}

export function createExporter(
  ctx: PluginContext,
  getConfig: () => Config,
  idle: Idle = defaultIdle,
): Exporter {
  const timers = new Map<string, { dispose(): void }>();
  const queue: string[] = [];
  let working = false;
  let warned = false;
  // Files the user must deal with by hand: told once each, not on every save.
  const taken = new Set<string>();

  const warn = (message: string, e: unknown) => {
    ctx.log.warn(message, e);
    if (!warned) {
      warned = true;
      ctx.ui.toast(`${message}: ${(e as Error)?.message ?? String(e)}`);
    }
  };

  async function exportNow(path: string, force: boolean): Promise<boolean> {
    const cfg = getConfig();
    const problem = folderProblem(cfg.folder);
    if (problem) {
      warn(problem, "");
      return false;
    }
    if (!force && isExcluded(path, cfg)) {
      return false;
    }
    try {
      if (!force && cfg.skipTag !== "") {
        const { elements } = await ctx.vault.readDrawing(path);
        if (hasSkipTag(elements, cfg.skipTag)) {
          return false;
        }
      }
      let wrote = false;
      for (const format of cfg.formats) {
        const done = await ctx.vault.exports.render(
          path,
          exportPath(path, format, cfg.folder),
          {
            format,
            scale: cfg.scale,
            background: cfg.background,
            dark: cfg.dark,
          },
        );
        wrote ||= done !== null;
      }
      if (wrote && cfg.notify) {
        ctx.ui.toast(`Exported ${path.replace(/\.excalidraw$/i, "")}`);
      }
      return wrote;
    } catch (e) {
      // The drawing was deleted or moved since the save: nothing to export.
      // A read-only vault cannot take exports: not worth a message on every save.
      if (codeOf(e) === "CONFLICT") {
        // A file with the export's name that an export did not make (made before exports were
        // tracked, or left by a sync conflict): never overwritten. Say so once, plainly.
        const file = conflictPath(e) ?? path;
        ctx.log.warn(`Could not export ${path}`, e);
        if (!taken.has(file)) {
          taken.add(file);
          ctx.ui.toast(
            `${file} already exists and was not made by auto-export, so it is left alone. Delete it or rename it and the next export will replace it.`,
          );
        }
      } else if (codeOf(e) !== "NOT_FOUND" && codeOf(e) !== "READ_ONLY") {
        warn(`Could not export ${path}`, e);
      }
      return false;
    }
  }

  function pump() {
    if (working) {
      return;
    }
    const next = queue.shift();
    if (next === undefined) {
      return;
    }
    working = true;
    idle(() => {
      void exportNow(next, false).finally(() => {
        working = false;
        pump();
      });
    });
  }

  return {
    schedule(path) {
      timers.get(path)?.dispose();
      timers.set(
        path,
        ctx.setTimeout(() => {
          timers.delete(path);
          if (!queue.includes(path)) {
            queue.push(path);
          }
          pump();
        }, getConfig().debounceMs),
      );
    },
    exportNow,
    clear() {
      timers.forEach((t) => t.dispose());
      timers.clear();
      queue.length = 0;
    },
    busy: () => working || queue.length > 0 || timers.size > 0,
  };
}
