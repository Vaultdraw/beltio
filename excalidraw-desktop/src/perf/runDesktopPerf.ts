import { invoke } from "@tauri-apps/api/core";

import fixturesConfig from "../../perf/fixtures.config.json";
import { desktopRepository } from "../vault/DesktopVaultRepository";

import { canvasCensus } from "./canvasTracker";
import {
  footprintTraceText,
  setPerfStep,
  startFootprintTrace,
} from "./footprintTrace";
import { installIpcTrace } from "./ipcTrace";
import { runPerfScenarios } from "./perfScenarios";

import type { PerfModes } from "./perfKit";
import type {
  NativeProbe,
  RefreshRateDrawing,
  RefreshRateInput,
} from "./refreshRate";

const IDLE_MS = 10_000;

/** pid -> role (app, webContent, gpu, network), resolved once. */
let processRoles: Map<string, string> | null = null;

/** Native side of the refresh-rate probe (smoke-test build commands). */
const nativeProbe = (maximize: boolean): NativeProbe => ({
  displayInfo: () =>
    invoke<Record<string, unknown>>("perf_display_info", { sampleMs: 500 }),
  input: (args) => invoke<Record<string, unknown>>("perf_native_input", args),
  processCpu: async () => {
    if (!processRoles) {
      const ids = await invoke<Record<string, number | null>>(
        "perf_process_ids",
      );
      processRoles = new Map(
        Object.entries(ids)
          .filter(([, pid]) => typeof pid === "number" && pid > 0)
          .map(([role, pid]) => [String(pid), role]),
      );
    }
    const cpu = await invoke<Record<string, number>>("perf_process_cpu", {
      pids: [...processRoles.keys()].map(Number),
    });
    return Object.fromEntries(
      Object.entries(cpu).map(([pid, seconds]) => [
        processRoles?.get(pid) ?? pid,
        seconds,
      ]),
    );
  },
  maximize: maximize ? () => invoke("perf_window_maximize") : undefined,
});

const SUITE_INPUTS: RefreshRateInput[] = [
  "idle",
  "zoom.native",
  "zoom.native.out",
  "pan.native",
  "pan.native.out",
];

/**
 * Refresh-rate drawings. Standalone suite: every paper style with 0 and 200
 * elements, plus the large drawings for the first two styles; full screen.
 * Harness: the small subset in fixtures.config.json, default window.
 */
const refreshRateOptions = (
  only: boolean,
  extra: RefreshRateDrawing[] = [],
  extraOnly = false,
) => {
  const spec = fixturesConfig.refreshRate;
  const drawing = (pattern: string, elements: number) => ({
    path: `hz-${pattern}-${elements}.excalidraw`,
    pattern,
    elements,
  });
  const large = Math.max(...spec.elements);
  const small = spec.elements.filter((n) => n !== large);
  return {
    native: nativeProbe(only),
    only,
    inputs: only
      ? SUITE_INPUTS
      : ([
          "zoom.native",
          "zoom.native.out",
          "pan.native",
        ] as RefreshRateInput[]),
    drawings: !only
      ? spec.harness.patterns.map((p) => drawing(p, spec.harness.elements))
      : extraOnly
      ? extra
      : [
          ...extra,
          ...spec.patterns.flatMap((p) => small.map((n) => drawing(p, n))),
          ...spec.harness.patterns.map((p) => drawing(p, large)),
        ],
  };
};

/**
 * Opt-in modes travel in the run vault's folder name (the runner names it `vault+leak`, `vault+typical`),
 * so the default gate run needs no switch and the app needs no extra hook.
 */
export function modesFromVaultPath(vaultPath: string): PerfModes {
  const name = vaultPath.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const tokens = name.split("+").slice(1);
  const leakOnly = tokens.includes("leakonly");
  return {
    leak: leakOnly || tokens.includes("leak"),
    leakOnly,
    typical: tokens.includes("typical"),
    ablate: tokens.includes("ablate"),
    warmGapMs:
      Number(tokens.find((token) => /^gap\d+$/.test(token))?.slice(3)) ||
      undefined,
  };
}

/** Elements likely to get their own compositing layer, with their size (memory diagnosis only). */
export function layerCensus(doc: Document): string {
  const win = doc.defaultView;
  if (!win) {
    return "";
  }
  const lines: string[] = [];
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("body *"))) {
    const rect = el.getBoundingClientRect();
    if (rect.width * rect.height < 40_000) {
      continue;
    }
    const cs = win.getComputedStyle(el);
    const why: string[] = [];
    if (el instanceof HTMLCanvasElement) {
      why.push(`canvas ${el.width}x${el.height}`);
    }
    if (el.tagName === "IFRAME" || el.tagName === "VIDEO") {
      why.push(el.tagName.toLowerCase());
    }
    if (cs.position === "fixed" || cs.position === "sticky") {
      why.push(cs.position);
    }
    if (cs.transform !== "none") {
      why.push(`transform ${cs.transform}`);
    }
    if (cs.willChange !== "auto") {
      why.push(`will-change ${cs.willChange}`);
    }
    if (cs.opacity !== "1") {
      why.push(`opacity ${cs.opacity}`);
    }
    if (cs.filter !== "none") {
      why.push("filter");
    }
    const backdrop =
      cs.getPropertyValue("backdrop-filter") ||
      cs.getPropertyValue("-webkit-backdrop-filter");
    if (backdrop && backdrop !== "none") {
      why.push("backdrop-filter");
    }
    if (cs.animationName !== "none") {
      why.push(`animation ${cs.animationName}`);
    }
    if (cs.isolation === "isolate" || cs.mixBlendMode !== "normal") {
      why.push("isolate/blend");
    }
    if (cs.contain !== "none") {
      why.push(`contain ${cs.contain}`);
    }
    if (
      /(auto|scroll)/.test(cs.overflowY + cs.overflowX) &&
      (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)
    ) {
      why.push(`scroller ${el.scrollWidth}x${el.scrollHeight}`);
    }
    if (why.length) {
      const cls =
        typeof el.className === "string"
          ? el.className.split(/\s+/).slice(0, 3).join(".")
          : "";
      lines.push(
        `${el.tagName.toLowerCase()}.${cls} ${Math.round(
          rect.width,
        )}x${Math.round(rect.height)}@${Math.round(rect.x)},${Math.round(
          rect.y,
        )} hidden=${
          cs.visibility === "hidden" || cs.display === "none"
        } | ${why.join("; ")}`,
      );
    }
  }
  lines.push(
    `window ${win.innerWidth}x${win.innerHeight} dpr ${win.devicePixelRatio}`,
  );
  return lines.join("\n");
}

/** Packaged-app perf run (VITE_APP_PERF_TEST=true). Reports through the smoke bridge. */
export async function runDesktopPerf(): Promise<void> {
  const win = window;
  const doc = win.document;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => win.setTimeout(resolve, ms));
  // Memory diagnosis (VAULTDRAW_PERF_LAYER_DIR): layer tree + DOM census per mark; off after the first "unset".
  let layerDump = true;
  const mark = async (name: string) => {
    await invoke<void>("smoke_log", {
      step: "perf-mark",
      ok: true,
      details: { name, wallMs: Date.now(), perfMs: win.performance.now() },
    });
    if (layerDump) {
      layerDump = await invoke<boolean>("perf_layer_tree", {
        label: name,
        dom: `${layerCensus(
          doc,
        )}\n== canvases\n${canvasCensus()}\n== footprint peak rises\n${footprintTraceText()}`,
      }).catch(() => false);
    }
  };

  const markPids = async () => {
    try {
      const pids = await invoke<unknown>("perf_process_ids");
      await invoke("smoke_log", {
        step: "perf-mark",
        ok: true,
        details: {
          name: "pids",
          wallMs: Date.now(),
          perfMs: win.performance.now(),
          pids,
        },
      });
    } catch (error) {
      await invoke("smoke_log", {
        step: "perf-mark",
        ok: false,
        details: { name: "pids", error: String(error) },
      });
    }
  };

  let root: HTMLElement | null = null;
  for (let i = 0; i < 200 && !root; i++) {
    root = doc.querySelector<HTMLElement>(".vault-app");
    if (!root) {
      await sleep(50);
    }
  }
  if (!root) {
    await invoke("smoke_finish", {
      status: 1,
      details: { startupFailure: "Timed out waiting for .vault-app mount" },
    });
    return;
  }

  // Keep the recent-vault preference write out of the user's real storage (same isolation as the smoke run).
  const preferencesKey = "excalidraw-vault-preferences-v1";
  try {
    const proto = Object.getPrototypeOf(win.localStorage) as Storage;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "setItem");
    if (descriptor?.value && descriptor.configurable) {
      const original = descriptor.value as Storage["setItem"];
      Object.defineProperty(proto, "setItem", {
        ...descriptor,
        value(this: Storage, key: string, value: string) {
          if (key !== preferencesKey) {
            return original.call(this, key, value);
          }
        },
      });
    }
  } catch {
    // Best effort; the perf run does not depend on it.
  }

  try {
    while (!root.querySelector(".vault-onboarding")) {
      await sleep(20);
    }
    await mark("interactive");
    await markPids();
    if (layerDump) {
      setPerfStep("onboarding");
      startFootprintTrace(
        win,
        await invoke<Record<string, number | null>>("perf_process_ids"),
      );
    }

    // Heartbeat: tells a stalled run apart (hidden/occluded WebView stops rAF, JS hang, IPC hang).
    // Stall diagnostics stop before the idle window. No rAF loop here: one would keep the WebView
    // rendering every frame and perturb the measurements (the scenarios' rAF watchdog reports stalls).
    const heartbeat = win.setInterval(() => {
      void invoke("smoke_log", {
        step: "perf-mark",
        ok: true,
        details: {
          name: "heartbeat",
          wallMs: Date.now(),
          perfMs: win.performance.now(),
          visibility: doc.visibilityState,
          hasFocus: doc.hasFocus(),
        },
      }).catch(() => undefined);
    }, 5000);
    const trace = installIpcTrace(desktopRepository, win, (name, details) => {
      void invoke("smoke_log", {
        step: "perf-mark",
        ok: true,
        details: {
          name,
          wallMs: Date.now(),
          perfMs: win.performance.now(),
          ...details,
        },
      }).catch(() => undefined);
    });
    const environment = await invoke<{
      perfSuite?: string;
      perfDrawings?: string;
      vaultPath?: string;
    }>("smoke_environment").catch(() => ({
      perfSuite: "",
      perfDrawings: "",
      vaultPath: "",
    }));
    const modes: PerfModes = modesFromVaultPath(environment.vaultPath ?? "");
    // "refresh-rate": the full probe suite; "refresh-rate-drawings": only the
    // extra drawings passed in VAULTDRAW_PERF_DRAWINGS.
    const suite = environment.perfSuite ?? "";
    const onlyRefreshRate = suite.startsWith("refresh-rate");
    let extraDrawings: RefreshRateDrawing[] = [];
    try {
      extraDrawings = environment.perfDrawings
        ? (JSON.parse(environment.perfDrawings) as RefreshRateDrawing[])
        : [];
    } catch {
      extraDrawings = [];
    }
    const { samples, info, errors } = await runPerfScenarios({
      root,
      doc,
      win,
      repository: desktopRepository,
      config: fixturesConfig,
      mark,
      refreshRate: refreshRateOptions(
        onlyRefreshRate,
        extraDrawings,
        suite === "refresh-rate-drawings",
      ),
      // Progress lines (smoke-progress.log) for the standalone suite only: the
      // full run keeps the vault folder free of extra writes.
      log: onlyRefreshRate
        ? (message) => {
            void invoke("smoke_log", { step: `~${message}`, ok: true }).catch(
              () => undefined,
            );
          }
        : undefined,
      modes,
    });

    if (onlyRefreshRate) {
      // Standalone refresh-rate suite: no idle / memory phase.
      trace.uninstall();
      win.clearInterval(heartbeat);
      await invoke("smoke_finish", {
        status: errors.length ? 1 : 0,
        details: { perf: { version: 1, env: "tauri", samples, info, errors } },
      });
      return;
    }

    // Idle must be truly idle: wait until autosave has settled (no write started for 1.5 s).
    let lastWriteAt = win.performance.now();
    let inFlight = 0;
    const originalWrite = desktopRepository.writeDrawing;
    desktopRepository.writeDrawing = async (input) => {
      inFlight += 1;
      lastWriteAt = win.performance.now();
      try {
        return await originalWrite(input);
      } finally {
        inFlight -= 1;
        lastWriteAt = win.performance.now();
      }
    };
    const settleUntil = win.performance.now() + 30_000;
    while (
      (inFlight > 0 || win.performance.now() - lastWriteAt < 1500) &&
      win.performance.now() < settleUntil
    ) {
      await sleep(100);
    }
    desktopRepository.writeDrawing = originalWrite;
    await markPids();

    Object.assign(info, trace.finish());
    trace.uninstall();
    win.clearInterval(heartbeat);
    await mark("idle-begin");
    await sleep(IDLE_MS);
    await mark("idle-end");
    // Keep the process alive while the runner reads footprint / cpu for the idle-end sample.
    await sleep(2000);

    await invoke("smoke_finish", {
      status: errors.length ? 1 : 0,
      details: {
        perf: { version: 1, env: "tauri", samples, info, errors },
      },
    });
  } catch (error) {
    await invoke("smoke_finish", {
      status: 1,
      details: { startupFailure: String(error) },
    });
  }
}
