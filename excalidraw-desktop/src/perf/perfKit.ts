/**
 * Toolkit the opt-in scenarios (leak, typical vault) share with the default
 * scenarios in perfScenarios.ts: DOM helpers, open/save/pan primitives and the
 * run-wide sample/info/error sinks. No environment-specific imports.
 */
import type fixturesConfig from "../../perf/fixtures.config.json";

export type PerfConfig = typeof fixturesConfig;

/** Opt-in run modes; the default gate run has none set. */
/** leakOnly: leak scenario straight after vault-open (clean baseline), without the stress phases. */
export type PerfModes = {
  leak?: boolean;
  leakOnly?: boolean;
  typical?: boolean;
  /** typical mode, the owner's everyday use: 3 small note drawings in tabs (implies typical). */
  everyday?: boolean;
  /** Memory ablation probe after the typical open (implies typical). */
  ablate?: boolean;
  /** typical mode: ms between the warm opens (vault token `gap<ms>`) */
  warmGapMs?: number;
};

export type PerfKit = {
  root: HTMLElement;
  doc: Document;
  win: Window & typeof globalThis;
  config: PerfConfig;
  modes: PerfModes;
  samples: Record<string, number[]>;
  info: Record<string, unknown>;
  errors: string[];
  mark: (name: string) => Promise<void>;
  log: (msg: string) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  raf: () => Promise<void>;
  afterPaint: () => Promise<void>;
  waitUntil: (label: string, cond: () => boolean, ms?: number) => Promise<void>;
  push: (id: string, value: number) => void;
  row: (path: string) => HTMLElement | null;
  treeRows: () => HTMLElement[];
  /** Scrolls the windowed tree until the row for `path` is mounted (gives up after `ms`). */
  revealRow: (path: string, ms?: number) => Promise<void>;
  childRows: (folder: string) => HTMLElement[];
  click: (el: HTMLElement | null, label: string) => void;
  key: (target: EventTarget, k: string, extra?: KeyboardEventInit) => void;
  interactiveCanvas: () => HTMLCanvasElement | null;
  editorId: () => string | null;
  /** Opens a drawing by its tree row: `total` = click to 2 painted frames (the open.* metrics), `ready` = click to the editor ready. */
  openByRow: (path: string) => Promise<{ total: number; ready: number }>;
  ensureOpen: (path: string) => Promise<void>;
  saveOnce: (path: string, metric: string) => Promise<void>;
  wheelPass: (
    canvas: HTMLCanvasElement,
    totalMs: number,
    makeEvent: (phase: 0 | 1) => WheelEventInit,
  ) => Promise<{ intervals: number[]; verified: boolean }>;
  scenario: (name: string, work: () => Promise<void>) => Promise<void>;
  wrapWrites: () => void;
  resetWrites: () => void;
};

/** Next scrollTop when searching a windowed tree for a row: one screen down, back to the top after the end. */
export function nextRevealScroll(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): number {
  return scrollTop + clientHeight >= scrollHeight - 1
    ? 0
    : scrollTop + Math.max(200, clientHeight * 0.8);
}

/** Click "Open vault folder" on the onboarding screen; resolves once `ready()` holds. Returns elapsed ms. */
export async function openVaultFolder(
  kit: PerfKit,
  ready: () => boolean,
): Promise<number> {
  const { root, now, waitUntil, afterPaint } = kit;
  // Loaded here, not at module level: every perf bundle imports this module.
  const { desktopRepository } = await import("../vault/DesktopVaultRepository");
  if (!root.querySelector(".vault-onboarding")) {
    throw new Error("Onboarding is not visible");
  }
  const button = Array.from(root.querySelectorAll("button")).find(
    (item) =>
      item.getAttribute("aria-label") === "Open vault folder" ||
      item.textContent?.trim() === "Open vault folder",
  );
  if (!button) {
    throw new Error('"Open vault folder" button not found');
  }
  // Diagnostics: track the choose_vault IPC so a hang can be placed (IPC vs UI).
  let choose = "not called";
  const originalChoose = desktopRepository.chooseVault;
  desktopRepository.chooseVault = (create?: boolean) => {
    choose = "pending";
    const started = now();
    const promise = originalChoose.call(desktopRepository, create);
    promise.then(
      (info) => {
        choose = `resolved ${Math.round(now() - started)} ms: ${info?.path}`;
      },
      (error) => {
        choose = `rejected: ${String(error?.message ?? error)}`;
      },
    );
    return promise;
  };
  const errors: string[] = [];
  const onError = (event: ErrorEvent) =>
    errors.push(`error: ${event.message} @${event.filename}:${event.lineno}`);
  const onRejection = (event: PromiseRejectionEvent) =>
    errors.push(`rejection: ${String(event.reason?.stack ?? event.reason)}`);
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(
      `console: ${args
        .map((arg) => (arg instanceof Error ? arg.stack : String(arg)))
        .join(" ")
        .slice(0, 600)}`,
    );
    originalConsoleError(...args);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  // Every repository call made while the vault opens, so a never-settling call shows by name.
  const ipc: { cmd: string; state: string; at: number }[] = [];
  const repo = desktopRepository as unknown as Record<string, unknown>;
  const originals = new Map<string, (...args: unknown[]) => unknown>();
  for (const name of Object.keys(repo)) {
    const fn = repo[name];
    if (typeof fn !== "function" || name === "chooseVault") {
      continue;
    }
    originals.set(name, fn as (...args: unknown[]) => unknown);
    repo[name] = (...args: unknown[]) => {
      const result = (fn as (...a: unknown[]) => unknown)(...args);
      if (result instanceof Promise) {
        const call = { cmd: name, state: "pending", at: Math.round(now()) };
        ipc.push(call);
        result.then(
          () => {
            call.state = "ok";
          },
          (error) => {
            call.state = `err ${String(error?.message ?? error).slice(0, 80)}`;
          },
        );
      }
      return result;
    };
  }
  const t0 = now();
  button.click();
  await waitUntil("root tree rows", ready, 60_000)
    .finally(() => {
      desktopRepository.chooseVault = originalChoose;
      for (const [name, fn] of originals) {
        repo[name] = fn;
      }
      console.error = originalConsoleError;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    })
    .catch((error) => {
      // Say what the window shows instead, so a UI change is quick to diagnose.
      const rows = kit.treeRows().map((item) => item.dataset.treePath);
      const state = {
        onboarding: Boolean(root.querySelector(".vault-onboarding")),
        navigator: Boolean(root.querySelector("[data-vault-path]")),
        choose,
        buttonDisabled: button.disabled,
        errors: errors.slice(0, 5),
        ipc: ipc.filter((call) => call.state !== "ok").slice(0, 10),
        ipcCount: ipc.length,
        ipcCmds: [...new Set(ipc.map((call) => call.cmd))].slice(0, 30),
        alerts: Array.from(
          root.querySelectorAll(".vault-onboarding__alert, [role=alert]"),
        ).map((item) => item.textContent?.trim()),
        rows: rows.length,
        firstRows: rows.slice(0, 5),
        dialogs: Array.from(root.querySelectorAll("[role=dialog]")).map(
          (item) => item.getAttribute("aria-label") ?? item.className,
        ),
      };
      throw new Error(`${(error as Error).message}; ${JSON.stringify(state)}`);
    });
  await afterPaint();
  return now() - t0;
}

/** Expand every ancestor folder of `folderPath` and the folder itself, waiting for its children. */
export async function expandFolder(
  kit: PerfKit,
  folderPath: string,
): Promise<void> {
  const { row, click, waitUntil, childRows, afterPaint } = kit;
  const parts = folderPath.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const current = parts.slice(0, i).join("/");
    await kit.revealRow(current);
    await waitUntil(`row ${current}`, () => Boolean(row(current)));
    if (row(current)?.getAttribute("aria-expanded") !== "true") {
      click(row(current), current);
    }
    await waitUntil(
      `children of ${current}`,
      () => childRows(current).length > 0,
    );
  }
  await afterPaint();
}
