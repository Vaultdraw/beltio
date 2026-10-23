/**
 * Dev log: the `ctx.log` lines and attributed errors of `dev = true` plugins go to
 * `<state dir>/plugin-logs/<id>.log` (Rust appends, caps and trims it), so a developer can
 * tail it (`vaultdraw-plugin dev` does). Other plugins never reach the backend; with no dev
 * plugin this module does nothing.
 */
import { currentList } from "./pluginsState";

import type { PluginLogLine } from "./errors";

/** Lines are sent together at most this often. */
export const DEV_LOG_FLUSH_MS = 250;
/** Rust refuses more than 64 KB per call. */
const CHUNK_CHARS = 32_000;

export interface DevLogDeps {
  isDev(id: string): boolean;
  send(id: string, text: string): Promise<void>;
  setTimer(fn: () => void, ms: number): unknown;
  now(): Date;
}

export interface DevLogSink {
  (id: string, level: PluginLogLine["level"], text: string): void;
  /** Sends what is buffered now (tests and quit). */
  flush(): void;
}

export function createDevLogSink(deps: DevLogDeps): DevLogSink {
  const pending = new Map<string, string[]>();
  let scheduled = false;
  // One send at a time, so the file keeps the order of the lines.
  let chain: Promise<void> = Promise.resolve();
  const flush = () => {
    scheduled = false;
    for (const [id, lines] of pending) {
      let chunk = "";
      const out: string[] = [];
      for (const l of lines) {
        if (chunk.length + l.length > CHUNK_CHARS && chunk) {
          out.push(chunk);
          chunk = "";
        }
        chunk += l;
      }
      out.push(chunk);
      for (const text of out) {
        // A failed dev log must never disturb the plugin or the host.
        chain = chain.then(() => deps.send(id, text)).catch(() => {});
      }
    }
    pending.clear();
  };
  const sink = ((id, level, text) => {
    if (!deps.isDev(id)) {
      return;
    }
    const line = `${deps.now().toISOString()} [${level}] ${text.slice(
      0,
      4000,
    )}\n`;
    const lines = pending.get(id);
    if (lines) {
      lines.push(line);
    } else {
      pending.set(id, [line]);
    }
    if (!scheduled) {
      scheduled = true;
      deps.setTimer(flush, DEV_LOG_FLUSH_MS);
    }
  }) as DevLogSink;
  sink.flush = flush;
  return sink;
}

/** The sink wired to the Tauri backend and the current plugin list. */
export const createAppDevLogSink = (win: Window): DevLogSink =>
  createDevLogSink({
    isDev: (id) => currentList().plugins.some((p) => p.id === id && p.dev),
    send: async (id, text) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("plugins_dev_log", { id, text });
    },
    setTimer: (fn, ms) => win.setTimeout(fn, ms),
    now: () => new Date(),
  });
