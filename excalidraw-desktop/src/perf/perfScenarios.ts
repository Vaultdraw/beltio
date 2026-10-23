/**
 * Shared perf scenarios. Environment-agnostic: runs in the packaged Tauri
 * WebView and (later) in Chromium against an in-memory repository. All input is
 * synthetic DOM events dispatched into the real app; timers bracket "event
 * dispatched" to "frame after the DOM updated has been presented".
 */
import { getEditorApi } from "../editor/editorApi";

import { runLeakScenario } from "./leakScenario";
import { collectFrames, countLong } from "./perfStats";
import { refreshRateSamples, runRefreshRateProbe } from "./refreshRate";
import { scenarioSelected } from "./scenarioFilter";
import { runTypicalScenarios } from "./typicalScenarios";

import type {
  NativeProbe,
  RefreshRateDrawing,
  RefreshRateInput,
} from "./refreshRate";

import type fixturesConfig from "../../perf/fixtures.config.json";
import type { PerfKit, PerfModes } from "./perfKit";
import type { ScenarioFilter } from "./scenarioFilter";
import type { VaultRepository } from "../vault/types";

export type PerfSamples = Record<string, number[]>;
export type PerfConfig = typeof fixturesConfig;

export type PerfContext = {
  root: HTMLElement;
  doc: Document;
  win: Window & typeof globalThis;
  /** The live repository object VaultApp uses; writeDrawing is wrapped temporarily. */
  repository: { writeDrawing: VaultRepository["writeDrawing"] };
  config: PerfConfig;
  /** Environment-specific live mark. */
  mark: (name: string) => Promise<void>;
  /** Opt-in modes (leak, typical vault); none in the default gate run. */
  modes?: PerfModes;
  /** Restrict which scenarios run (the base-vs-head comparison runs only what both sides have). */
  scenarioFilter?: ScenarioFilter;
  iterations?: Partial<{
    open: number;
    save: number;
    typingChars: number;
    panMs: number;
    zoomMs: number;
  }>;
  log?: (msg: string) => void;
  /**
   * Refresh-rate probe (packaged app only: needs native input). `only` skips
   * every other scenario (the standalone `perf/refresh-rate.mjs` suite).
   */
  refreshRate?: {
    native: NativeProbe | null;
    drawings: RefreshRateDrawing[];
    inputs: RefreshRateInput[];
    only?: boolean;
  };
};

type PerfResult = {
  samples: PerfSamples;
  info: Record<string, unknown>;
  errors: string[];
};

const DEFAULTS = {
  open: 3,
  save: 3,
  typingChars: 40,
  panMs: 2000,
  zoomMs: 2000,
};

const OPEN_TIMEOUT = 30_000;

export async function runPerfScenarios(ctx: PerfContext): Promise<PerfResult> {
  const { root, doc, win, config } = ctx;
  const iter = { ...DEFAULTS, ...ctx.iterations };
  const samples: PerfSamples = {};
  const info: Record<string, unknown> = {};
  const errors: string[] = [];
  const log = (msg: string) => ctx.log?.(msg);

  const push = (id: string, value: number) => {
    (samples[id] ??= []).push(value);
  };
  const now = () => win.performance.now();
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => win.setTimeout(resolve, ms));

  /** rAF with a watchdog: a hidden/occluded window stops rAF, so fail fast instead of hanging. */
  const raf = () =>
    new Promise<void>((resolve, reject) => {
      let fired = false;
      win.requestAnimationFrame(() => {
        fired = true;
        resolve();
      });
      win.setTimeout(() => {
        if (fired) {
          return;
        }
        // Grace period: a long main-thread block delays timer and frame alike.
        win.setTimeout(() => {
          if (!fired) {
            reject(new Error("rAF stalled (window hidden/occluded?)"));
          }
        }, 500);
      }, 2000);
    });

  /** rAF, then a macrotask: resolves once the frame that followed the DOM change was produced. */
  const afterPaint = async () => {
    await raf();
    await new Promise<void>((resolve) => {
      const channel = new win.MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(0);
    });
  };

  /** Resolves as soon as `cond` holds: checked on every DOM mutation (before paint) plus a 25ms poll. */
  const waitUntil = (
    label: string,
    cond: () => boolean,
    ms = 30_000,
  ): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      let finished = false;
      let observer: MutationObserver | null = null;
      let interval = 0;
      let timer = 0;
      const done = (error?: Error) => {
        if (finished) {
          return;
        }
        finished = true;
        observer?.disconnect();
        win.clearInterval(interval);
        win.clearTimeout(timer);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const check = () => {
        try {
          if (cond()) {
            done();
          }
        } catch (error) {
          done(error as Error);
        }
      };
      check();
      if (finished) {
        return;
      }
      observer = new win.MutationObserver(check);
      observer.observe(doc.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      interval = win.setInterval(check, 25);
      timer = win.setTimeout(
        () => done(new Error(`Timed out after ${ms}ms waiting for ${label}`)),
        ms,
      );
    });

  const esc = (value: string) => win.CSS.escape(value);
  const row = (path: string) =>
    root.querySelector<HTMLElement>(
      `.vault-tree-item[data-tree-path="${esc(path)}"]`,
    );
  const treeRows = () =>
    Array.from(
      root.querySelectorAll<HTMLElement>(".vault-tree-item[data-tree-path]"),
    );
  const childRows = (folder: string) =>
    treeRows().filter((item) => {
      const path = item.dataset.treePath ?? "";
      return (
        path.startsWith(`${folder}/`) &&
        !path.slice(folder.length + 1).includes("/")
      );
    });
  const searchInput = () => {
    const input = root.querySelector<HTMLInputElement>(
      "input.vault-search__input",
    );
    if (!input) {
      throw new Error("Search input not found");
    }
    return input;
  };
  const setSearch = (value: string) => {
    const input = searchInput();
    const setter = Object.getOwnPropertyDescriptor(
      win.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
  };
  const searchRows = () =>
    Array.from(
      root.querySelectorAll<HTMLElement>(
        // F1 search results (`.vault-search-row`); filtered tree rows in older builds.
        ".vault-search-row, .vault-tree-container .vault-tree-item:not([data-tree-path])",
      ),
    );
  const click = (el: HTMLElement | null, label: string) => {
    if (!el) {
      throw new Error(`Element not found: ${label}`);
    }
    el.click();
  };
  // App shortcuts match exact chords: Cmd on macOS, Ctrl elsewhere (never both).
  const MOD: KeyboardEventInit = /Mac/.test(win.navigator.platform)
    ? { metaKey: true }
    : { ctrlKey: true };
  const key = (target: EventTarget, k: string, extra: KeyboardEventInit = {}) =>
    target.dispatchEvent(
      new win.KeyboardEvent("keydown", {
        key: k,
        code: k.length === 1 ? `Key${k.toUpperCase()}` : k,
        bubbles: true,
        cancelable: true,
        ...extra,
      }),
    );
  const interactiveCanvas = () =>
    root.querySelector<HTMLCanvasElement>(".vault-editor canvas.interactive");
  const editorId = () =>
    root
      .querySelector<HTMLElement>(".vault-editor")
      ?.getAttribute("data-document-id") ?? null;

  /** Excalidraw may collapse to zero height in WebKit when flex parents are unsized (same fix as the smoke). */
  const fixEditorSize = () => {
    for (const selector of [".vault-editor", ".vault-editor .excalidraw"]) {
      const el = root.querySelector<HTMLElement>(selector);
      if (el && el.offsetHeight === 0) {
        el.style.flex = "1 1 auto";
        el.style.minHeight = "0";
        el.style.height = "100%";
      }
    }
  };

  const isEditorReady = (path: string, previousId: string | null) => {
    const id = editorId();
    if (!id || id === previousId || !id.endsWith(`:${path}`)) {
      return false;
    }
    if (root.querySelector(".vault-editor-container--busy")) {
      return false;
    }
    // The scene is on screen, not just the editor shell: a fresh editor
    // names its document before the drawing has loaded, so without this a
    // fresh-editor open (the way drawings opened before the in-place swap)
    // stops its clock long before the drawing appears.
    if (!getEditorApi(id)) {
      return false;
    }
    if (doc.querySelector(".LoadingMessage")) {
      return false;
    }
    const activeTitle = root.querySelector<HTMLElement>(
      ".vault-tree-item--active .vault-tree-item__name",
    )?.title;
    if (activeTitle !== undefined && activeTitle !== path) {
      return false;
    }
    const canvas = interactiveCanvas();
    return Boolean(
      canvas &&
        root.querySelector(".vault-editor canvas.static") &&
        canvas.getBoundingClientRect().width > 0,
    );
  };

  /** Opens a root-level drawing via its tree row; returns elapsed ms (click to 2 painted frames). */
  const openByRow = async (path: string): Promise<number> => {
    const target = row(path);
    if (!target) {
      throw new Error(`Tree row not found: ${path}`);
    }
    const previousId = editorId();
    const t0 = now();
    target.click();
    await waitUntil(
      `editor for ${path}`,
      () => isEditorReady(path, previousId),
      OPEN_TIMEOUT,
    );
    await afterPaint();
    await afterPaint();
    const elapsed = now() - t0;
    fixEditorSize();
    return elapsed;
  };
  const isOpen = (path: string) => {
    const id = editorId();
    return Boolean(id && id.endsWith(`:${path}`));
  };
  const ensureOpen = async (path: string) => {
    if (isOpen(path) && isEditorReady(path, null)) {
      return;
    }
    // Switch away first when needed so the open is a real load.
    await openByRow(path);
  };

  const pointer = (
    el: Element,
    type: string,
    x: number,
    y: number,
    buttons = 1,
  ) =>
    el.dispatchEvent(
      new win.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons,
        clientX: x,
        clientY: y,
      }),
    );

  // ---- repository write instrumentation -------------------------------------------------
  type WriteRecord = {
    path: string;
    start: number;
    end: number | null;
    ok: boolean;
  };
  let writes: WriteRecord[] = [];
  const originalWrite = ctx.repository.writeDrawing;
  let wrapped = false;
  const wrapWrites = () => {
    if (wrapped) {
      return;
    }
    wrapped = true;
    ctx.repository.writeDrawing = async (input) => {
      const record: WriteRecord = {
        path: input.path,
        start: now(),
        end: null,
        ok: false,
      };
      writes.push(record);
      try {
        const result = await originalWrite(input);
        record.ok = true;
        return result;
      } finally {
        record.end = now();
      }
    };
  };
  const unwrapWrites = () => {
    if (wrapped) {
      ctx.repository.writeDrawing = originalWrite;
      wrapped = false;
    }
  };

  const scenario = async (name: string, work: () => Promise<void>) => {
    if (!scenarioSelected(name, ctx.scenarioFilter)) {
      log(`scenario ${name} skipped by filter`);
      return;
    }
    await ctx.mark(`phase:${name}`);
    log(`scenario ${name}`);
    const started = now();
    try {
      await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${name}: ${message}`);
      log(`scenario ${name} failed: ${message}`);
    } finally {
      unwrapWrites();
      info[`scenarioMs.${name}`] = Math.round(now() - started);
    }
  };

  const refreshRateScenario = async () => {
    const probe = ctx.refreshRate;
    if (!probe) {
      return;
    }
    await scenario("refresh-rate", async () => {
      const result = await runRefreshRateProbe({
        win,
        root,
        open: ensureOpen,
        native: probe.native,
        drawings: probe.drawings,
        inputs: probe.inputs,
        log,
      });
      info.refreshRate = result;
      for (const [id, values] of Object.entries(refreshRateSamples(result))) {
        // Budgets assume a 120 Hz screen; on a 60 Hz one the numbers are info only.
        if (result.displayHz >= 120) {
          samples[id] = values;
        }
      }
    });
  };

  if (ctx.refreshRate?.only) {
    await scenario("vault-open", async () => {
      const openButton = Array.from(root.querySelectorAll("button")).find(
        (item) =>
          item.getAttribute("aria-label") === "Open Vault Folder" ||
          item.textContent?.trim() === "Open Vault Folder",
      );
      if (!openButton) {
        throw new Error('"Open Vault Folder" button not found');
      }
      openButton.click();
      const paths = ctx.refreshRate?.drawings.map((d) => d.path) ?? [];
      await waitUntil(
        "refresh-rate drawing rows",
        () => paths.every((path) => Boolean(row(path))),
        60_000,
      );
      await afterPaint();
    });
    await refreshRateScenario();
    return { samples, info, errors };
  }

  const { openTargets, bigFolder, needle } = config;
  const rootSegment = (path: string) => path.split("/")[0];

  // Boot marks (report-only): performance.mark("vaultdraw:boot:<name>") -> startup.<name> in ms since
  // navigation start. Absent marks (Chromium harness, older builds) simply yield no sample.
  for (const entry of win.performance.getEntriesByType("mark")) {
    const match = /^vaultdraw:boot:(.+)$/.exec(entry.name);
    if (match) {
      push(`startup.${match[1]}`, entry.startTime);
    }
  }

  // 5. save ----------------------------------------------------------------------------
  const saveOnce = async (path: string, metric: string) => {
    const canvas = interactiveCanvas();
    if (!canvas) {
      throw new Error("No interactive canvas for save");
    }
    // Previous writes settled and autosave quiet before editing.
    await waitUntil("pending writes settled", () =>
      writes.every((record) => record.end !== null),
    );
    await sleep(900);
    key(doc, "Escape");
    key(canvas, "a", MOD);
    await afterPaint();
    key(canvas, "ArrowRight");
    await afterPaint();
    // Explicit save straight after the edit, so it is the write being measured.
    const t0 = now();
    const first = writes.length;
    key(doc, "s", MOD);
    let record: WriteRecord | undefined;
    await waitUntil(
      `writeDrawing for ${path}`,
      () => {
        record = writes
          .slice(first)
          .find((item) => item.path === path && item.start >= t0);
        return Boolean(record && record.end !== null);
      },
      15_000,
    );
    if (!record!.ok) {
      throw new Error(`writeDrawing failed for ${path}`);
    }
    push(metric, record!.end! - t0);
    key(doc, "Escape");
    await afterPaint();
  };
  // 6. pan / zoom ----------------------------------------------------------------------
  /** Tiny fingerprint of the static canvas, to prove the viewport really changed. */
  const fingerprint = () => {
    const source = root.querySelector<HTMLCanvasElement>(
      ".vault-editor canvas.static",
    );
    if (!source || !source.width || !source.height) {
      return null;
    }
    const probe = doc.createElement("canvas");
    probe.width = 48;
    probe.height = 48;
    const context = probe.getContext("2d");
    if (!context) {
      return null;
    }
    context.drawImage(source, 0, 0, 48, 48);
    return Array.from(context.getImageData(0, 0, 48, 48).data);
  };
  const differs = (a: number[] | null, b: number[] | null) =>
    Boolean(a && b && a.some((value, index) => value !== b[index]));

  const wheelPass = async (
    canvas: HTMLCanvasElement,
    totalMs: number,
    makeEvent: (phase: 0 | 1) => WheelEventInit,
  ) => {
    const bounds = canvas.getBoundingClientRect();
    const cx = bounds.left + bounds.width / 2;
    const cy = bounds.top + bounds.height / 2;
    // Excalidraw zooms around the last known pointer position.
    pointer(canvas, "pointermove", cx, cy, 0);
    await afterPaint();
    const before = fingerprint();
    const frames = collectFrames(win);
    const start = now();
    let mid: number[] | null = null;
    while (now() - start < totalMs) {
      const phase = now() - start < totalMs / 2 ? 0 : 1;
      if (phase === 1 && mid === null) {
        mid = fingerprint() ?? [];
      }
      canvas.dispatchEvent(
        new win.WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: cx,
          clientY: cy,
          ...makeEvent(phase),
        }),
      );
      await raf();
    }
    const intervals = frames.stop();
    await afterPaint();
    return { intervals, verified: differs(before, mid) };
  };

  const kit: PerfKit = {
    root,
    doc,
    win,
    config,
    modes: ctx.modes ?? {},
    samples,
    info,
    errors,
    mark: ctx.mark,
    log,
    now,
    sleep,
    raf,
    afterPaint,
    waitUntil,
    push,
    row,
    treeRows,
    childRows,
    click,
    key,
    interactiveCanvas,
    editorId,
    openByRow,
    ensureOpen,
    saveOnce,
    wheelPass,
    scenario,
    wrapWrites,
    resetWrites: () => {
      writes = [];
    },
  };
  if (kit.modes.typical) {
    // Typical-vault mode replaces the stress-vault scenarios.
    await runTypicalScenarios(kit);
    unwrapWrites();
    return { samples, info, errors };
  }

  // 1. vault-open ----------------------------------------------------------------------
  await scenario("vault-open", async () => {
    if (!root.querySelector(".vault-onboarding")) {
      throw new Error("Onboarding is not visible");
    }
    const openButton = Array.from(root.querySelectorAll("button")).find(
      (item) =>
        item.getAttribute("aria-label") === "Open Vault Folder" ||
        item.textContent?.trim() === "Open Vault Folder",
    );
    if (!openButton) {
      throw new Error('"Open Vault Folder" button not found');
    }
    const requiredRoots = new Set([
      openTargets.large,
      rootSegment(bigFolder.path),
      rootSegment(needle.path),
    ]);
    const t0 = now();
    openButton.click();
    // Diagnostics: when the navigator and the first rows appear.
    void waitUntil(
      "navigator",
      () => Boolean(root.querySelector("[data-vault-path]")),
      60_000,
    )
      .then(() => {
        info.navigatorMs = Math.round(now() - t0);
      })
      .catch(() => undefined);
    void waitUntil("first row", () => treeRows().length > 0, 60_000)
      .then(() => {
        info.firstRowMs = Math.round(now() - t0);
      })
      .catch(() => undefined);
    await waitUntil(
      "root tree rows",
      () =>
        requiredRoots.size > 0 &&
        Array.from(requiredRoots).every((path) => Boolean(row(path))),
      60_000,
    );
    info.rootRowCount = treeRows().filter(
      (item) => !(item.dataset.treePath ?? "").includes("/"),
    ).length;
    await afterPaint();
    push("vault.openToTree", now() - t0);

    // Index readiness: the needle only matches once the background crawl reached it.
    setSearch(needle.query);
    let lastToggle = now();
    await waitUntil(
      "needle search result",
      () => {
        const rows = searchRows();
        if (rows.length === 1 && rows[0].textContent?.includes(needle.query)) {
          return true;
        }
        if (now() - lastToggle > 1000) {
          // Nudge the search in case results only recompute on input.
          lastToggle = now();
          setSearch("");
          setSearch(needle.query);
        }
        return false;
      },
      60_000,
    );
    await afterPaint();
    push("vault.searchIndexReady", now() - t0);
    setSearch("");
    await afterPaint();
  });

  if (kit.modes.leakOnly) {
    await scenario("leak", () => runLeakScenario(kit));
    return { samples, info, errors };
  }

  // 2. tree-expand ---------------------------------------------------------------------
  await scenario("tree-expand", async () => {
    const parts = bigFolder.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join("/");
      if (!row(bigFolder.path)) {
        if (row(ancestor)?.getAttribute("aria-expanded") !== "true") {
          click(row(ancestor), ancestor);
        }
        await waitUntil(`row ${parts.slice(0, i + 1).join("/")}`, () =>
          Boolean(row(parts.slice(0, i + 1).join("/"))),
        );
      }
    }
    await afterPaint();
    for (let k = 0; k < iter.open; k++) {
      const folder = row(bigFolder.path);
      if (!folder) {
        throw new Error(`Big folder row missing: ${bigFolder.path}`);
      }
      if (folder.getAttribute("aria-expanded") === "true") {
        folder.click();
        await waitUntil(
          "big folder collapsed",
          () => childRows(bigFolder.path).length === 0,
        );
        await afterPaint();
      }
      const t0 = now();
      folder.click();
      await waitUntil(
        "big folder children",
        // The tree is windowed: wait for the first visible child rows, not all of them.
        () =>
          row(bigFolder.path)?.getAttribute("aria-expanded") === "true" &&
          childRows(bigFolder.path).length > 0,
      );
      await afterPaint();
      push("tree.expandBigFolder", now() - t0);
      info.bigFolderRows = bigFolder.drawings;
      info.bigFolderMountedRows = childRows(bigFolder.path).length;
      row(bigFolder.path)?.click();
      await waitUntil(
        "big folder collapsed",
        () => childRows(bigFolder.path).length === 0,
      );
      await afterPaint();
    }
  });

  // 3. search --------------------------------------------------------------------------
  await scenario("search", async () => {
    // Frame pacing floor: interval between back-to-back rAFs with no DOM work.
    // Every "until the next frame" metric (search/typing keystroke, pan/zoom)
    // includes up to one interval; under macOS background QoS (--low-end) the
    // OS coalesces the frame timer to ~100 ms, which no CPU-side fix can beat.
    {
      let last = now();
      const until = last + 1000;
      while (now() < until) {
        await raf();
        const t = now();
        push("frame.rafInterval", t - last);
        last = t;
      }
    }
    for (let round = 0; round < 2; round++) {
      for (const query of config.searchQueries) {
        setSearch("");
        await afterPaint();
        for (let i = 1; i <= query.length; i++) {
          const prefix = query.slice(0, i);
          const t0 = now();
          setSearch(prefix);
          push("search.keystrokeJs", now() - t0);
          if (searchInput().value !== prefix) {
            throw new Error("Search input did not take the typed value");
          }
          await afterPaint();
          push("search.keystroke", now() - t0);
        }
        info[`searchResultText.${query}`] =
          root
            .querySelector(".vault-tree-container > div > div")
            ?.textContent?.trim() ?? null;
      }
      setSearch("");
      await afterPaint();
    }
  });

  // 4. open ----------------------------------------------------------------------------
  await scenario("open", async () => {
    const sizes = ["small", "medium", "large"] as const;
    for (let k = 0; k < iter.open; k++) {
      for (const size of sizes) {
        push(`open.${size}`, await openByRow(openTargets[size]));
        // Let post-open work (autosave bookkeeping, image decoding) settle.
        await sleep(300);
      }
    }
  });

  // 4b. switch drawing ---------------------------------------------------------------
  // With one drawing open, select another in the navigator: click to its canvas painted.
  // The first switch to each drawing is switch.drawing; later A-B-A switches back to a
  // recently opened drawing are switch.recent.
  await scenario("switch", async () => {
    const pair = [openTargets.small, openTargets.medium];
    await ensureOpen(pair[1]);
    await sleep(300);
    const seen = new Set<string>();
    for (let k = 0; k < iter.open * 4; k++) {
      const target = pair[k % 2];
      const elapsed = await openByRow(target);
      push(seen.has(target) ? "switch.recent" : "switch.drawing", elapsed);
      seen.add(target);
      await sleep(300);
    }
  });

  // 4c. settings + palette ---------------------------------------------------------------
  /** Dispatches a chord on the document (window dispatcher), `code` set like a real key. */
  const chord = (k: string, code: string, extra: KeyboardEventInit = {}) =>
    key(doc, k, { code, ...MOD, ...extra });
  const modalGone = (selector: string) => () => !doc.querySelector(selector);

  await scenario("settings", async () => {
    await ensureOpen(openTargets.small);
    await sleep(300);
    for (let k = 0; k < iter.open; k++) {
      const t0 = now();
      chord(",", "Comma");
      await waitUntil(
        "settings page",
        () =>
          Boolean(
            doc.querySelector(".vault-settings-modal .vault-settings-body"),
          ),
        5000,
      );
      await afterPaint();
      push("settings.open", now() - t0);
      await sleep(200);
      const t1 = now();
      key(doc, "Escape");
      await waitUntil(
        "settings closed",
        modalGone(".vault-settings-modal"),
        5000,
      );
      await afterPaint();
      push("settings.close", now() - t1);
      await sleep(300);
    }
  });

  await scenario("palette", async () => {
    await ensureOpen(openTargets.small);
    await sleep(300);
    const rows = () => doc.querySelectorAll(".vault-quick__row").length > 0;
    for (const [metric, k, extra] of [
      ["palette.openFiles", "p", {}],
      ["palette.openCommands", "P", { shiftKey: true }],
    ] as const) {
      for (let i = 0; i < iter.open; i++) {
        const t0 = now();
        chord(k, "KeyP", extra);
        await waitUntil("palette rows", rows, 5000);
        await afterPaint();
        push(metric, now() - t0);
        await sleep(200);
        const input = doc.querySelector<HTMLElement>(".vault-quick__input");
        key(input ?? doc, "Escape");
        await waitUntil("palette closed", modalGone(".vault-quick"), 5000);
        await afterPaint();
        await sleep(300);
      }
    }
  });

  await scenario("save", async () => {
    wrapWrites();
    writes = [];
    for (const [size, metric] of [
      ["medium", "save.medium"],
      ["large", "save.large"],
    ] as const) {
      await ensureOpen(openTargets[size]);
      await sleep(300);
      for (let k = 0; k < iter.save; k++) {
        await saveOnce(openTargets[size], metric);
      }
    }
  });

  await scenario("pan-zoom", async () => {
    await ensureOpen(openTargets.large);
    await sleep(500);
    const canvas = interactiveCanvas();
    if (!canvas) {
      throw new Error("No interactive canvas for pan/zoom");
    }
    // Shift+wheel pans horizontally regardless of the detected input device
    // (a plain wheel zooms when Excalidraw thinks a mouse is in use).
    const pan = await wheelPass(canvas, iter.panMs, (phase) => ({
      deltaX: 0,
      deltaY: phase === 0 ? 40 : -40,
      shiftKey: true,
    }));
    samples["pan.frame"] = pan.intervals;
    push("pan.longFrames", countLong(pan.intervals));
    info.panVerified = pan.verified;
    await sleep(300);
    const zoom = await wheelPass(canvas, iter.zoomMs, (phase) => ({
      deltaX: 0,
      deltaY: phase === 0 ? -10 : 10,
      ctrlKey: true,
    }));
    samples["zoom.frame"] = zoom.intervals;
    push("zoom.longFrames", countLong(zoom.intervals));
    info.zoomVerified = zoom.verified;
  });

  // 6b. refresh rate (packaged app) ----------------------------------------------------
  await refreshRateScenario();

  // 7. typing --------------------------------------------------------------------------
  await scenario("typing", async () => {
    await ensureOpen(openTargets.medium);
    if (editorId()?.endsWith(`:${openTargets.large}`)) {
      throw new Error("Medium drawing did not open");
    }
    await sleep(500);
    const canvas = interactiveCanvas();
    if (!canvas) {
      throw new Error("No interactive canvas for typing");
    }
    const editor = () =>
      doc.querySelector<HTMLTextAreaElement>("textarea.excalidraw-wysiwyg");
    key(doc, "Escape");
    await afterPaint();
    const target = config.typingTarget;
    const bounds = canvas.getBoundingClientRect();
    // appState scroll 0 / zoom 1: viewport = canvas origin + scene coordinates.
    const x = bounds.left + target.x + target.width / 2;
    const y = bounds.top + target.y + target.height / 2;
    info.typingClick = { x, y, canvasLeft: bounds.left, canvasTop: bounds.top };
    pointer(canvas, "pointermove", x, y, 0);
    pointer(canvas, "pointerdown", x, y, 1);
    pointer(canvas, "pointerup", x, y, 0);
    await afterPaint();
    await sleep(150);
    key(canvas, "Enter");
    await waitUntil("WYSIWYG editor", () => Boolean(editor()), 3000).catch(
      () => {
        throw new Error(
          "Selecting the typing target by click did not open its label editor",
        );
      },
    );
    const textarea = editor()!;
    textarea.focus();
    const alphabet = "perf typing sample ";
    const frames = collectFrames(win);
    for (let i = 0; i < iter.typingChars; i++) {
      const current = editor();
      if (!current) {
        frames.stop();
        throw new Error("WYSIWYG editor closed while typing");
      }
      const char = alphabet[i % alphabet.length];
      const t0 = now();
      current.value += char;
      current.dispatchEvent(
        new win.InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: char,
        }),
      );
      push("typing.keystrokeJs", now() - t0);
      await afterPaint();
      push("typing.keystroke", now() - t0);
    }
    push("typing.longFrames", countLong(frames.stop()));
    key(editor() ?? doc, "Escape");
    await waitUntil("WYSIWYG editor closed", () => !editor(), 3000).catch(
      () => {
        // Escape twice: the first commits the text, a second deselects.
        key(doc, "Escape");
      },
    );
    await afterPaint();
  });

  if (kit.modes.leak) {
    await scenario("leak", () => runLeakScenario(kit));
  }

  unwrapWrites();
  return { samples, info, errors };
}
