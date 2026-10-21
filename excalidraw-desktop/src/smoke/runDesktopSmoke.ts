import { createGlobalTemplateStore } from "../templates/globalTemplates";
import { instantiateTemplate } from "../templates/instantiate";
import { listTemplates, readTemplateJson } from "../templates/listTemplates";
import { desktopRepository } from "../vault/DesktopVaultRepository";

import { DEFAULT_PREFERENCES, getPreferences } from "../vault/preferences";

import {
  getSettingsStatus,
  PREFERENCES_CHANGED_EVENT,
  SETTINGS_STATUS_EVENT,
} from "../vault/settingsSync";

import {
  clipboardCopyStep,
  exportDialogOptionsStep,
  exportViaDialog,
  mermaidOfflineStep,
  perfExportMermaidStep,
} from "./exportSmoke";
import { explorerExportStep } from "./explorerExportSmoke";
import { runHistorySmoke } from "./historySmoke";
import { runLibrarySmoke } from "./librarySmoke";
import { runLinksSmoke } from "./linksSmoke";
import {
  paperDefaultStampedStep,
  paperDrawingPngExportStep,
} from "./paperSmoke";
import {
  openSmokeDrawing,
  pageDefaultStampedStep,
  pageModeSwitchStep,
  pagePdfExportStep,
} from "./pageModeSmoke";
import { runPensSmoke } from "./pensSmoke";
import {
  earlierFailures,
  RELOAD_STEP,
  reloadResumeStep,
  requestReload,
  takeReloadMarker,
} from "./reloadSmoke";
import { runThumbnailsSmoke } from "./thumbnailsSmoke";

import type { InvokeFn } from "../vault/DesktopVaultRepository";

import type { ExportSmokeContext } from "./exportSmoke";

import type {
  ConfigChange,
  LoadSettingsResult,
  SettingsStatus,
} from "../vault/settingsSync";
import type {
  PreferencesSnapshot,
  VaultPreferences,
} from "../vault/preferences";

import type { VaultEntry, VaultInfo } from "../vault/types";

type SmokeRecord = {
  step: string;
  ok: boolean;
  ms?: number;
  details?: unknown;
};
type SmokeEnvironment = {
  enabled: boolean;
  vaultPath: string;
  exportPath: string;
};

type Native = {
  choose_vault: (args: { create: boolean }) => Promise<VaultInfo | null>;
  reopen_vault: () => Promise<VaultInfo | null>;
  create_folder: (args: { handle: string; path: string }) => Promise<void>;
  list_directory: (args: {
    handle: string;
    path: string;
  }) => Promise<VaultEntry[]>;
  write_drawing: (args: {
    handle: string;
    path: string;
    json: string;
    expectedRevision: string | null;
    operationId: string;
  }) => Promise<{ revision: string }>;
  read_drawing: (args: {
    handle: string;
    path: string;
  }) => Promise<{ json: string; revision: string }>;
  move_entry: (args: {
    handle: string;
    from: string;
    to: string;
  }) => Promise<void>;
  search_vault: (args: {
    handle: string;
    query: string;
    limit?: number;
    scope?: string;
  }) => Promise<{
    results: Array<{
      path: string;
      matches: Array<{ snippet: string; elementId: string }>;
    }>;
    totalMatches: number;
    status: { state: string; indexed: number; total: number };
  }>;
  vault_tags: (args: { handle: string }) => Promise<{
    tags: Array<{ tag: string; display: string; count: number }>;
    byPath: Record<string, string[]>;
  }>;
  search_index_status: (args: { handle: string }) => Promise<{
    state: string;
    indexed: number;
    total: number;
  }>;
  load_settings: () => Promise<LoadSettingsResult>;
  update_config: (args: { changes: ConfigChange[] }) => Promise<void>;
  load_vault_settings: (args: { handle: string }) => Promise<{
    path: string;
    settings: Record<string, unknown> | null;
    settingsError: { message: string; line?: number | null } | null;
  }>;
  update_vault_settings: (args: {
    handle: string;
    changes: ConfigChange[];
  }) => Promise<void>;
  smoke_environment: () => Promise<SmokeEnvironment>;
  smoke_log: (args: {
    step: string;
    ok: boolean;
    details?: unknown;
  }) => Promise<void>;
  smoke_finish: (args: { status: number; details?: unknown }) => Promise<void>;
};

const timeout = 12_000;

/** config.toml defaults from personal/planning/config.md, as load_settings JSON. */
const DEFAULT_CONFIG_JSON = {
  appearance: {
    theme: "Default",
    mode: "system",
    sync_canvas: false,
    canvas_background: "#ffffff",
  },
  editor: {
    font_family: 5,
    font_size: 20,
    stroke_color: "#1e1e1e",
    background_color: "transparent",
    fill_style: "solid",
    stroke_width: 2,
    roughness: 1,
  },
  saving: { autosave_delay_ms: 500 },
  // Commented-out tables in the default config.toml parse as empty tables.
  interface: {},
  navigator: {},
  files: {},
  paper: {},
  hotkeys: {},
  pens: {},
  laser: {},
};

/** Recursive key-order-insensitive comparison; returns mismatching paths. */
const diffJson = (expected: unknown, actual: unknown, path = ""): string[] => {
  if (
    expected &&
    typeof expected === "object" &&
    actual &&
    typeof actual === "object"
  ) {
    const e = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;
    const keys = new Set([...Object.keys(e), ...Object.keys(a)]);
    return Array.from(keys).flatMap((key) =>
      diffJson(e[key], a[key], path ? `${path}.${key}` : key),
    );
  }
  return expected === actual
    ? []
    : [
        `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(
          actual,
        )}`,
      ];
};

/**
 * Config diff. The default config.toml lists every other table commented
 * out, and those parse as empty tables; any empty table the expectation
 * does not name is fine, so a new config section needs no smoke edit.
 */
const diffConfig = (expected: object, actual: unknown): string[] => {
  const named = new Set(Object.keys(expected));
  const relevant =
    actual && typeof actual === "object"
      ? Object.fromEntries(
          Object.entries(actual).filter(
            ([table, value]) =>
              named.has(table) ||
              !(
                value &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                Object.keys(value).length === 0
              ),
          ),
        )
      : actual;
  return diffJson(expected, relevant);
};

const withConfig = (
  patch: Record<string, Record<string, unknown>>,
): typeof DEFAULT_CONFIG_JSON => {
  const next = JSON.parse(JSON.stringify(DEFAULT_CONFIG_JSON));
  for (const [table, values] of Object.entries(patch)) {
    Object.assign(next[table], values);
  }
  return next;
};
const delay = (win: Window, ms: number) =>
  new Promise<void>((resolve) => win.setTimeout(resolve, ms));

/** Run in the packaged Tauri WebView after VaultApp mounts. No WebDriver/Accessibility required. */
export async function runDesktopSmoke(): Promise<void> {
  // Initial mount lookup may use globals; everything after derives from ownerDocument/defaultView.
  const bootDoc = typeof document !== "undefined" ? document : null;
  const bootWin =
    bootDoc?.defaultView ?? (typeof window !== "undefined" ? window : null);
  const bootDelay = (ms: number) =>
    new Promise<void>((resolve) => {
      if (bootWin) {
        bootWin.setTimeout(resolve, ms);
      } else {
        setTimeout(resolve, ms);
      }
    });
  // Bounded wait for the mount so a missing/slow root reports to native instead of throwing pre-log.
  let root: HTMLElement | null = null;
  const rootUntil = Date.now() + 10_000;
  while (!root && Date.now() < rootUntil) {
    root = bootDoc?.querySelector<HTMLElement>(".vault-app") ?? null;
    if (!root) {
      await bootDelay(100);
    }
  }
  if (!root) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("smoke_finish", {
        status: 1,
        details: { startupFailure: "Timed out waiting for .vault-app mount" },
      });
    } catch (finishError) {
      console.error(
        "Desktop smoke could not report missing mount",
        finishError,
      );
    }
    return;
  }
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  if (!win) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("smoke_finish", {
        status: 1,
        details: { startupFailure: "Mounted app has no owner window" },
      });
    } catch (finishError) {
      console.error(
        "Desktop smoke could not report missing owner window",
        finishError,
      );
    }
    return;
  }
  // A locked screen or occluded window hides the WebView: requestAnimationFrame
  // never fires and the editor cannot render, so the run would hang. Fail fast.
  const visibleUntil = win.performance.now() + 15_000;
  while (
    doc.visibilityState !== "visible" &&
    win.performance.now() < visibleUntil
  ) {
    await new Promise<void>((resolve) => win.setTimeout(resolve, 250));
  }
  if (doc.visibilityState !== "visible") {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("smoke_finish", {
        status: 1,
        details: {
          startupFailure: `WebView is ${doc.visibilityState} (screen locked or window occluded): the packaged smoke test needs a visible window`,
        },
      });
    } catch (finishError) {
      console.error(
        "Desktop smoke could not report hidden WebView",
        finishError,
      );
    }
    return;
  }
  const startedAt = win.performance.now();
  // Time from navigation start to the app being mounted and the runner starting.
  const mountedAtMs = Math.round(startedAt);
  const records: SmokeRecord[] = [];
  const pageErrors: Array<{ type: string; message: string }> = [];
  // VaultApp stores recent paths in localStorage; suppress that preference write for this run.
  const preferencesKey = "excalidraw-vault-preferences-v1";
  let preferenceWritesSuppressed = false;
  let restoreStorage = () => {};
  try {
    const storage = win.localStorage;
    const storagePrototype = Object.getPrototypeOf(storage) as Storage;
    const storageSetDescriptor = Object.getOwnPropertyDescriptor(
      storagePrototype,
      "setItem",
    );
    if (!storageSetDescriptor?.value || !storageSetDescriptor.configurable) {
      throw new Error("Storage.setItem cannot be isolated");
    }
    const originalSetItem = storageSetDescriptor.value as Storage["setItem"];
    Object.defineProperty(storagePrototype, "setItem", {
      ...storageSetDescriptor,
      value(this: Storage, key: string, value: string) {
        if (key !== preferencesKey) {
          return originalSetItem.call(this, key, value);
        }
      },
    });
    restoreStorage = () =>
      Object.defineProperty(storagePrototype, "setItem", storageSetDescriptor);
    preferenceWritesSuppressed = true;
  } catch (error) {
    pageErrors.push({ type: "preference-isolation", message: String(error) });
  }
  const onError = (event: ErrorEvent) =>
    pageErrors.push({ type: "error", message: event.message });
  const onRejection = (event: PromiseRejectionEvent) =>
    pageErrors.push({
      type: "unhandledrejection",
      message: String(event.reason),
    });
  // Upstream Excalidraw's SVG export sets style="white-space: pre;" on text
  // nodes (renderer), which the packaged CSP reports as style-src-attr. The
  // attribute still serializes into the file, so it is tracked separately
  // and only while the smoke run's SVG export is in flight.
  const knownCspReports: unknown[] = [];
  let svgExportInFlight = false;
  const onCsp = (event: SecurityPolicyViolationEvent) =>
    (svgExportInFlight &&
    (event.violatedDirective === "style-src-attr" ||
      event.violatedDirective === "style-src-elem")
      ? knownCspReports
      : pageErrors
    ).push({
      type: "csp",
      message: `${event.violatedDirective}: ${event.blockedURI}`,
      // Where/when: helps tell product CSP problems from harness ones.
      afterStep: records[records.length - 1]?.step ?? "(none)",
      source: `${event.sourceFile}:${event.lineNumber}`,
      sample: event.sample,
      disposition: event.disposition,
    } as { type: string; message: string });
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);
  doc.addEventListener("securitypolicyviolation", onCsp);

  const { invoke } = await import("@tauri-apps/api/core");
  // Drawing read/write use a raw-bytes IPC frame; go through the repository
  // codec so smoke steps keep the `{ json, revision }` shape.
  const invokeNative = (
    command: string,
    args?: Record<string, unknown>,
  ): Promise<unknown> => {
    if (command === "read_drawing") {
      const { handle, path } = args as { handle: string; path: string };
      return desktopRepository.readDrawing(handle, path);
    }
    if (command === "write_drawing") {
      return desktopRepository.writeDrawing(
        args as Parameters<typeof desktopRepository.writeDrawing>[0],
      );
    }
    return invoke(command, args);
  };
  const call = <K extends keyof Native>(
    command: K,
    args?: Record<string, unknown>,
  ) => invokeNative(command, args) as ReturnType<Native[K]>;

  const waitFor = async <T>(
    label: string,
    read: () => T | null | undefined,
    ms = timeout,
  ): Promise<T> => {
    const until = win.performance.now() + ms;
    while (win.performance.now() < until) {
      const result = read();
      if (result != null) {
        return result;
      }
      await delay(win, 50);
    }
    throw new Error(`Timed out after ${ms}ms waiting for ${label}`);
  };
  // Progress marks go straight to smoke-progress.log (see smoke.rs).
  const mark = (label: string) =>
    call("smoke_log", { step: `~${label}`, ok: true }).catch(() => {});
  const STEP_TIMEOUT_MS = 300_000;
  const step = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    const started = win.performance.now();
    void mark(`start ${name}`);
    const ms = () => Math.round(win.performance.now() - started);
    try {
      // A hung IPC call must fail the step, not the whole run.
      let timer = 0;
      const details = await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = win.setTimeout(
            () =>
              reject(
                new Error(`Step timed out after ${STEP_TIMEOUT_MS / 1000}s`),
              ),
            STEP_TIMEOUT_MS,
          );
        }),
      ]).finally(() => win.clearTimeout(timer));
      records.push({ step: name, ok: true, ms: ms(), details });
      void mark(`ok ${name} ${ms()}ms`);
      return details;
    } catch (error) {
      records.push({ step: name, ok: false, ms: ms(), details: String(error) });
      void mark(`FAILED ${name} ${ms()}ms ${String(error).slice(0, 200)}`);
      throw error;
    }
  };
  // A failing step is still recorded as failed (and the final "Failed steps"
  // throw stays), but the run goes on after it. Dialogs the step left open are
  // closed so the next step starts clean. Used for the steps that don't gate
  // the rest (startup and the first editor drawing stay hard steps).
  const softStep = <T>(name: string, work: () => Promise<T>): Promise<T> =>
    step(name, work).catch(async () => {
      doc
        .querySelector<HTMLElement>(
          '.vault-settings-modal [aria-label="Close Settings"]',
        )
        ?.click();
      doc.querySelector<HTMLElement>(".Modal__background")?.click();
      doc.dispatchEvent(
        new win.KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await delay(win, 200);
      return undefined as unknown as T;
    });
  const button = (name: string) => {
    const found = Array.from(root.querySelectorAll("button")).find(
      (item) =>
        item.getAttribute("aria-label") === name ||
        item.title === name ||
        item.textContent?.trim() === name,
    );
    if (!found) {
      throw new Error(`UI button not found: ${name}`);
    }
    return found;
  };
  /** Runs a command through the palette (Cmd+Shift+P, type, Enter). */
  const runPaletteCommand = async (query: string) => {
    const dialog = () =>
      doc.querySelector<HTMLElement>(
        '[role="dialog"][aria-label="Command palette"]',
      );
    const key = (init: KeyboardEventInit, target: EventTarget = doc) =>
      target.dispatchEvent(
        new win.KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    key({
      key: "p",
      metaKey: true,
      ctrlKey: true,
      shiftKey: true,
    });
    const input = await waitFor("command palette input", () =>
      dialog()?.querySelector<HTMLInputElement>(".vault-quick__input"),
    );
    Object.getOwnPropertyDescriptor(
      win.HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, `>${query}`);
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    await waitFor(`command row for ${query}`, () =>
      dialog()?.querySelector(".vault-quick__row"),
    );
    await delay(win, 100);
    key({ key: "Enter", code: "Enter" }, input);
    await waitFor("command palette closed", () => (dialog() ? null : true));
  };
  const clickSubmit = async (dialog: Element, name: string) => {
    const input = dialog.querySelector<HTMLInputElement>("#create-entry-name");
    const submit = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>("button"),
    ).find((item) => item.textContent?.trim() === "Create");
    if (!input || !submit) {
      throw new Error(
        "Create dialog did not expose expected name field and submit button",
      );
    }
    const setter = Object.getOwnPropertyDescriptor(
      win.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, name);
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
    // Controlled React input enables submit asynchronously; wait a tick so .click() does not hit disabled submit.
    await delay(win, 0);
    await waitFor(
      "create submit enabled",
      () => (submit.disabled ? null : submit),
      5000,
    );
    submit.click();
  };

  let exitStatus = 1;
  let vaultForReport: VaultInfo | null = null;
  try {
    if (!preferenceWritesSuppressed) {
      throw new Error(
        "Smoke run cannot proceed without suppressing recent-vault preference writes",
      );
    }
    const env = await call("smoke_environment");
    if (!env.enabled || !env.vaultPath) {
      throw new Error("Native smoke environment is not enabled");
    }
    // Resumed after the page-reload step's location.reload(): run only that step.
    const resumed = takeReloadMarker(win.sessionStorage, Date.now());
    if (resumed) {
      await step(RELOAD_STEP, () =>
        reloadResumeStep({
          win,
          root,
          vaultPath: env.vaultPath,
          waitFor,
          clickOpenVault: () => button("Open Vault Folder").click(),
          call: invokeNative as never,
        }),
      );
      // The earlier launch's failures live in the marker; keep failing on them.
      const earlier = earlierFailures(resumed);
      if (earlier.length) {
        throw new Error(`Failed before the reload: ${earlier.join(", ")}`);
      }
      if (pageErrors.length) {
        throw new Error(
          `WebView reported errors: ${JSON.stringify(pageErrors)}`,
        );
      }
      exitStatus = 0;
      return;
    }
    const vault = await step(
      "startup-and-onboarding",
      async (): Promise<VaultInfo> => {
        await waitFor("onboarding", () =>
          root.querySelector(".vault-onboarding"),
        );
        const elapsedMs = Math.round(win.performance.now() - startedAt);
        const originalChooseVault = desktopRepository.chooseVault;
        let chosenPromise: Promise<VaultInfo | null> | null = null;
        desktopRepository.chooseVault = async (create?: boolean) => {
          const promise = originalChooseVault.call(desktopRepository, create);
          chosenPromise = promise;
          return promise;
        };
        let chosen: VaultInfo | null = null;
        try {
          button("Open Vault Folder").click();
          try {
            vaultForReport = await waitFor("native test vault", () => {
              const path =
                root.querySelector<HTMLElement>("[data-vault-path]")?.dataset
                  .vaultPath;
              return path === env.vaultPath
                ? { handle: "", path, name: "", readOnly: false }
                : null;
            });
          } catch (error) {
            // Say what the screen showed instead of only that it timed out.
            const seen =
              root.querySelector<HTMLElement>("[data-vault-path]")?.dataset
                .vaultPath;
            const settled = chosenPromise
              ? await Promise.race([
                  (chosenPromise as Promise<VaultInfo | null>).then(
                    (info) => `chooseVault -> ${JSON.stringify(info)}`,
                    (e) => `chooseVault rejected: ${String(e)}`,
                  ),
                  new Promise<string>((r) =>
                    win.setTimeout(() => r("chooseVault pending"), 500),
                  ),
                ])
              : "chooseVault never called";
            throw new Error(
              `${String(error)}; expected ${env.vaultPath}, saw ${
                seen ?? "none"
              }; ${settled}; onboarding: ${
                root
                  .querySelector(".vault-onboarding")
                  ?.textContent?.slice(0, 300) ?? "gone"
              }`,
            );
          }
          const interceptedPromise = await waitFor(
            "UI choose_vault IPC result",
            () => chosenPromise,
          );
          chosen = await interceptedPromise;
          if (!chosen || chosen.path !== env.vaultPath) {
            throw new Error(
              "UI choose_vault did not return configured test folder",
            );
          }
          vaultForReport = chosen;
        } finally {
          desktopRepository.chooseVault = originalChooseVault;
        }
        return Object.assign(chosen, {
          elapsedMs,
          method:
            "onboarding UI click intercepted at desktopRepository.chooseVault IPC",
        });
      },
    );
    vaultForReport = vault;
    const activeVault = vault;
    const runId = Math.floor(win.Date.now()).toString(36);
    const nested = `smoke-suite-${runId}/nested`;
    const filePath = `${nested}/ipc-fixture.excalidraw`;
    let watcherPromise: Promise<unknown> | undefined;
    let listenReady: Promise<void> | undefined;
    let stopListening: (() => void) | undefined;
    try {
      const { listen } = await import("@tauri-apps/api/event");
      watcherPromise = new Promise((resolve) => {
        listenReady = listen("vault-change", (event) => {
          const payload = event.payload as {
            handle?: string;
            paths?: string[];
          };
          if (
            payload.handle === activeVault.handle &&
            payload.paths?.some((path) => path.includes("watcher-own-write"))
          ) {
            resolve(payload);
          }
        }).then((off) => {
          stopListening = off;
        });
      });
    } catch {
      /* listener failure is reported by explicit watch step */
    }

    await step("native-crud-read-write-list", async () => {
      await call("create_folder", {
        handle: activeVault.handle,
        path: `smoke-suite-${runId}`,
      });
      await call("create_folder", { handle: activeVault.handle, path: nested });
      const source = JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "desktop-smoke",
        elements: [],
        appState: {},
        files: {},
      });
      await call("write_drawing", {
        handle: activeVault.handle,
        path: filePath,
        json: source,
        expectedRevision: null,
        operationId: "smoke-ipc-create",
      });
      const read = await call("read_drawing", {
        handle: activeVault.handle,
        path: filePath,
      });
      if (JSON.parse(read.json).type !== "excalidraw" || !read.revision) {
        throw new Error("IPC read returned invalid Excalidraw JSON/revision");
      }
      const entries = await call("list_directory", {
        handle: activeVault.handle,
        path: nested,
      });
      if (
        !entries.some(
          (entry) => entry.path === filePath && entry.kind === "drawing",
        )
      ) {
        throw new Error("IPC listing missed created drawing");
      }
      return {
        path: filePath,
        operations: "native IPC fixture provisioning + read/list assertions",
      };
    });
    await step("native-export-sandbox", async () => {
      const name = `smoke-export-${runId}.txt`;
      // Same raw-body IPC the editor uses (bytes + x-file-name header).
      const bytes = new TextEncoder().encode("offline smoke export");
      const exported = await desktopRepository.exportFile(name, bytes);
      if (!exported) {
        throw new Error(
          "Smoke export was canceled instead of writing inside the sandbox",
        );
      }
      return {
        file: `${env.exportPath}/${name}`,
        noDialog: true,
        constrainedByNative: "smoke-exports subdirectory",
      };
    });
    await step("native-watcher-own-write", async () => {
      await listenReady;
      const path = `${nested}/watcher-own-write.excalidraw`;
      const json = JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements: [],
        appState: {},
        files: {},
      });
      await call("write_drawing", {
        handle: activeVault.handle,
        path,
        json,
        expectedRevision: null,
        operationId: "smoke-watcher-own-write",
      });
      if (!watcherPromise) {
        throw new Error("Tauri event listener unavailable");
      }
      const event = await Promise.race([
        watcherPromise,
        delay(win, 5000).then(() => {
          throw new Error("No vault-change event for own write within 5s");
        }),
      ]);
      return {
        event,
        limitation:
          "asserts native write reaches subscribed WebView; app-level refresh remains UI worker behavior",
      };
    });
    stopListening?.();

    await step("native-search-index", async () => {
      const dir = `smoke-search-${runId}`;
      const label = (id: string, text: string) => ({
        id,
        type: "text",
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        text,
        originalText: text,
        isDeleted: false,
      });
      const scene = (...texts: string[]) =>
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          source: "desktop-smoke",
          elements: texts.map((text, i) => label(`t${i}`, text)),
          appState: {},
          files: {},
        });
      const latin = `${dir}/latin-${runId}.excalidraw`;
      const cjk = `${dir}/cjk-${runId}.excalidraw`;
      const needle = `quokkaneedle${runId}`;
      await call("create_folder", { handle: activeVault.handle, path: dir });
      for (const [path, json, op] of [
        [latin, scene(`Caf\u00e9 ${needle} graph`), "smoke-search-latin"],
        [
          cjk,
          scene("\u6570\u636e\u5e93\u8bbe\u8ba1 ", `${needle}cjk`),
          "smoke-search-cjk",
        ],
      ]) {
        await call("write_drawing", {
          handle: activeVault.handle,
          path,
          json,
          expectedRevision: null,
          operationId: op,
        });
      }
      const find = (query: string) =>
        call("search_vault", { handle: activeVault.handle, query });
      const pathsFor = async (query: string) =>
        (await find(query)).results.map((hit) => hit.path);
      const poll = async (
        what: string,
        done: (paths: string[]) => boolean,
        query: string,
      ) => {
        const until = win.performance.now() + 10_000;
        let last: string[] = [];
        while (win.performance.now() < until) {
          last = await pathsFor(query);
          if (done(last)) {
            return last;
          }
          await delay(win, 100);
        }
        throw new Error(
          `Timed out waiting for ${what}; last results for ${JSON.stringify(
            query,
          )}: ${JSON.stringify(last)}`,
        );
      };
      const startedSearch = win.performance.now();
      await poll("latin drawing indexed", (p) => p.includes(latin), needle);
      const hitMs = Math.round(win.performance.now() - startedSearch);
      await poll(
        "accent-insensitive content",
        (p) => p.includes(latin),
        "CAFE",
      );
      await poll(
        "CJK drawing indexed",
        (p) => p.includes(cjk),
        "\u6570\u636e\u5e93",
      );
      const response = await find(needle);
      const hit = response.results.find((item) => item.path === latin);
      if (!hit || !hit.matches[0]?.snippet.includes(needle)) {
        throw new Error("Search hit has no snippet containing the needle");
      }
      // Rename: the old path disappears, the new one is found.
      const renamed = `${dir}/renamed-${runId}.excalidraw`;
      await call("move_entry", {
        handle: activeVault.handle,
        from: latin,
        to: renamed,
      });
      await poll(
        "rename reflected",
        (p) => p.includes(renamed) && !p.includes(latin),
        needle,
      );
      const status = await call("search_index_status", {
        handle: activeVault.handle,
      });
      if (status.state !== "ready" || status.indexed < 2 || status.total < 2) {
        throw new Error(`Index not ready: ${JSON.stringify(status)}`);
      }
      return { dir, firstHitMs: hitMs, renamed, status };
    });

    await step("native-tags", async () => {
      const dir = `smoke-tags-${runId}`;
      // Tags are letters only: digits would still be valid, but keep the key
      // trivially predictable (a-j replace 0-9).
      const letters = runId.replace(/[0-9]/g, (d) =>
        String.fromCharCode(97 + Number(d)),
      );
      const parent = `smoketag${letters}`;
      const child = `${parent}/child`;
      const label = (id: string, text: string) => ({
        id,
        type: "text",
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        text,
        originalText: text,
        isDeleted: false,
      });
      const scene = (...texts: string[]) =>
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          source: "desktop-smoke",
          elements: texts.map((text, i) => label(`t${i}`, text)),
          appState: {},
          files: {},
        });
      const first = `${dir}/first-${runId}.excalidraw`;
      const second = `${dir}/second-${runId}.excalidraw`;
      const write = (path: string, json: string, op: string, rev: unknown) =>
        call("write_drawing", {
          handle: activeVault.handle,
          path,
          json,
          expectedRevision: rev,
          operationId: op,
        });
      await call("create_folder", { handle: activeVault.handle, path: dir });
      const firstWrite = await write(
        first,
        scene(
          `notes #${child}`,
          `link https://example.com/page#fragmentnottag${letters}`,
        ),
        "smoke-tags-first",
        null,
      );
      await write(second, scene(`notes #${parent}`), "smoke-tags-second", null);

      const readTags = () => call("vault_tags", { handle: activeVault.handle });
      const countOf = (
        tags: Array<{ tag: string; count: number }>,
        key: string,
      ) => tags.find((t) => t.tag === key)?.count ?? 0;
      const pollTags = async (
        what: string,
        done: (res: Awaited<ReturnType<typeof readTags>>) => boolean,
      ) => {
        const until = win.performance.now() + 10_000;
        let last: unknown = null;
        while (win.performance.now() < until) {
          const res = await readTags();
          last = res.tags.filter((t: { tag: string }) =>
            t.tag.includes(letters),
          );
          if (done(res)) {
            return res;
          }
          await delay(win, 100);
        }
        throw new Error(
          `Timed out waiting for ${what}; last matching tags: ${JSON.stringify(
            last,
          )}`,
        );
      };
      const startedTags = win.performance.now();
      const tagged = await pollTags(
        "nested tag counts",
        (res) =>
          countOf(res.tags, parent) === 2 && countOf(res.tags, child) === 1,
      );
      const tagsMs = Math.round(win.performance.now() - startedTags);
      if (
        !(tagged.byPath[first] ?? []).some((t: string) => t === child) ||
        !(tagged.byPath[second] ?? []).some((t: string) => t === parent)
      ) {
        throw new Error(
          `vault_tags byPath is missing the smoke drawings: ${JSON.stringify([
            tagged.byPath[first],
            tagged.byPath[second],
          ])}`,
        );
      }
      if (
        tagged.tags.some((t: { tag: string }) =>
          t.tag.includes("fragmentnottag"),
        )
      ) {
        throw new Error("A URL fragment was indexed as a tag");
      }

      const pathsFor = async (query: string) =>
        (
          await call("search_vault", { handle: activeVault.handle, query })
        ).results.map((hit: { path: string }) => hit.path);
      const pollPaths = async (
        what: string,
        query: string,
        done: (paths: string[]) => boolean,
      ) => {
        const until = win.performance.now() + 10_000;
        let last: string[] = [];
        while (win.performance.now() < until) {
          last = await pathsFor(query);
          if (done(last)) {
            return last;
          }
          await delay(win, 100);
        }
        throw new Error(
          `Timed out waiting for ${what}; last results for ${JSON.stringify(
            query,
          )}: ${JSON.stringify(last)}`,
        );
      };
      // A parent tag includes its children; a child tag is narrower.
      await pollPaths(
        "parent tag finds both drawings",
        `tag:#${parent}`,
        (p) => p.includes(first) && p.includes(second),
      );
      await pollPaths(
        "child tag finds only the nested drawing",
        `tag:#${child}`,
        (p) => p.includes(first) && !p.includes(second),
      );
      const fragmentHits = await pathsFor(`tag:#fragmentnottag${letters}`);
      if (fragmentHits.length > 0) {
        throw new Error(
          `URL fragment matched as a tag: ${JSON.stringify(fragmentHits)}`,
        );
      }

      // Editing the tag out of the text removes it from the index.
      await write(
        first,
        scene(
          "notes without tags",
          `link https://example.com/page#fragmentnottag${letters}`,
        ),
        "smoke-tags-edit",
        firstWrite.revision,
      );
      await pollTags(
        "removed tag to disappear",
        (res) =>
          countOf(res.tags, child) === 0 && countOf(res.tags, parent) === 1,
      );
      await pollPaths(
        "tag filter to drop the edited drawing",
        `tag:#${parent}`,
        (p) => !p.includes(first) && p.includes(second),
      );
      return { dir, tag: parent, firstTagsMs: tagsMs };
    });

    await runLinksSmoke({
      win,
      handle: activeVault.handle,
      runId,
      step,
      invoke: invokeNative,
    });

    await runHistorySmoke({
      handle: activeVault.handle,
      runId,
      step,
      invoke: invokeNative,
    });

    await softStep("ui-create-drawing-and-open-editor", async () => {
      const outer = await waitFor("suite folder tree row", () =>
        Array.from(
          root.querySelectorAll<HTMLElement>(".vault-tree-item__name"),
        ).find((item) => item.textContent?.trim() === `smoke-suite-${runId}`),
      );
      outer.closest<HTMLElement>(".vault-tree-item")?.click();
      const folder = await waitFor("nested folder tree row", () =>
        Array.from(
          root.querySelectorAll<HTMLElement>(".vault-tree-item__name"),
        ).find(
          (item) =>
            item.title === nested || item.textContent?.trim() === "nested",
        ),
      );
      folder.closest<HTMLElement>(".vault-tree-item")?.click();
      // Row actions mount only while the row is hovered/focused/active (eb66bbd), so a
      // button found a moment ago can be unmounted by a re-render before the click lands.
      // Re-query on each attempt and record what was clicked if the dialog never opens.
      const findCreateInFolder = () =>
        root
          .querySelector<HTMLElement>(
            `.vault-tree-item__name[title="${nested}"]`,
          )
          ?.closest<HTMLElement>(".vault-tree-item")
          ?.querySelector<HTMLButtonElement>(
            '[aria-label="New drawing in folder"]',
          ) ??
        folder
          .closest<HTMLElement>(".vault-tree-item")
          ?.querySelector<HTMLButtonElement>(
            '[aria-label="New drawing in folder"]',
          ) ??
        root.querySelector<HTMLButtonElement>(
          '[aria-label="New drawing in folder"]',
        );
      const attempts: string[] = [];
      let dialog: Element | null = null;
      for (let attempt = 0; attempt < 4 && !dialog; attempt += 1) {
        const createInFolder = await waitFor(
          "new drawing in folder action",
          findCreateInFolder,
        );
        attempts.push(
          `connected=${createInFolder.isConnected} row=${
            createInFolder
              .closest(".vault-tree-item")
              ?.querySelector<HTMLElement>(".vault-tree-item__name")?.title
          }`,
        );
        createInFolder.click();
        dialog = await waitFor(
          "drawing create dialog",
          () =>
            root.querySelector('[role="dialog"]') ??
            doc.querySelector('[role="dialog"]'),
          2000,
        ).catch(() => null);
      }
      if (!dialog) {
        throw new Error(
          `drawing create dialog never opened; attempts: ${attempts.join(
            " | ",
          )}; active=${
            doc.activeElement?.className ?? "none"
          }; dialogs in document=${
            doc.querySelectorAll('[role="dialog"]').length
          }`,
        );
      }
      await clickSubmit(dialog, "ui-edited.excalidraw");
      await waitFor("actual editor mount", () =>
        root.querySelector(".vault-editor [data-testid], .vault-editor canvas"),
      );
      await waitFor("active UI path", () =>
        root.querySelector<HTMLElement>(
          ".vault-tree-item--active .vault-tree-item__name",
        )?.title === `${nested}/ui-edited.excalidraw`
          ? true
          : null,
      );
      return {
        path: `${nested}/ui-edited.excalidraw`,
        method: "create through navigator UI; editor from mounted VaultEditor",
      };
    });

    // When the UI create path fails (recorded above as failed), provision the same
    // drawing natively and open it from the tree so the remaining steps still run.
    await step("smoke-drawing-open", async () => {
      const uiPath = `${nested}/ui-edited.excalidraw`;
      const activeTitle = () =>
        root.querySelector<HTMLElement>(
          ".vault-tree-item--active .vault-tree-item__name",
        )?.title;
      if (
        activeTitle() === uiPath &&
        root.querySelector(".vault-editor canvas")
      ) {
        return { path: uiPath, provisioned: false };
      }
      await call("write_drawing", {
        handle: vault.handle,
        path: uiPath,
        json: JSON.stringify({
          type: "excalidraw",
          version: 2,
          source: "desktop-smoke",
          elements: [],
          appState: {},
          files: {},
        }),
        expectedRevision: null,
        operationId: "smoke-ui-edited-fallback",
      }).catch(() => undefined); // already on disk: just open it
      const row = await waitFor("ui-edited tree row", () =>
        root.querySelector<HTMLElement>(
          `.vault-tree-item__name[title="${uiPath}"]`,
        ),
      );
      row.closest<HTMLElement>(".vault-tree-item")?.click();
      await waitFor("ui-edited active", () =>
        activeTitle() === uiPath ? true : null,
      );
      await waitFor("actual editor mount", () =>
        root.querySelector(".vault-editor canvas"),
      );
      return { path: uiPath, provisioned: true };
    });

    // Informational: about 120 on ProMotion displays when WebKit's 60fps cap is
    // disabled (see webview_configuration in lib.rs), about 60 otherwise.
    await softStep("render-frame-rate", async () => {
      // Bounded: an occluded window never delivers animation frames, which
      // would otherwise hang the whole run with no report.
      const frames = await new Promise<number>((resolve) => {
        win.setTimeout(() => resolve(-1), 4000);
        let count = 0;
        let start = 0;
        const tick = (now: number) => {
          start ||= now;
          count += 1;
          if (now - start < 1000) {
            win.requestAnimationFrame(tick);
          } else {
            resolve(Math.round((count * 1000) / (now - start)));
          }
        };
        win.requestAnimationFrame(tick);
      });
      return { requestAnimationFramePerSecond: frames };
    });

    await softStep("canvas-pointer-draw", async () => {
      // Ensure editor and excalidraw container resolve flex height in WebKit
      const editorEl = root.querySelector<HTMLElement>(".vault-editor");
      if (editorEl && editorEl.offsetHeight === 0) {
        editorEl.style.flex = "1 1 auto";
        editorEl.style.minHeight = "0";
        editorEl.style.height = "100%";
      }
      const excalidrawEl = root.querySelector<HTMLElement>(
        ".vault-editor .excalidraw",
      );
      if (excalidrawEl && excalidrawEl.offsetHeight === 0) {
        excalidrawEl.style.flex = "1 1 auto";
        excalidrawEl.style.minHeight = "0";
        excalidrawEl.style.height = "100%";
      }
      const canvas = await waitFor(
        "usable Excalidraw canvas",
        () => {
          const el =
            root.querySelector<HTMLCanvasElement>(
              ".vault-editor canvas.interactive",
            ) ??
            root.querySelector<HTMLCanvasElement>(
              ".vault-editor .interactive-canvas",
            ) ??
            root.querySelector<HTMLCanvasElement>(".vault-editor canvas");
          if (!el) {
            return null;
          }
          const b = el.getBoundingClientRect();
          return b.width >= 40 && b.height >= 40 ? el : null;
        },
        5000,
      );
      const bounds = canvas.getBoundingClientRect();
      const canvasInfo = {
        width: bounds.width,
        height: bounds.height,
        hasPointerEvent: Boolean(win.PointerEvent),
        offsetWidth: canvas.offsetWidth,
        offsetHeight: canvas.offsetHeight,
      };
      if (!win.PointerEvent) {
        throw new Error(
          `PointerEvent unavailable in WebView: ${JSON.stringify(canvasInfo)}`,
        );
      }
      if (bounds.width < 40 || bounds.height < 40) {
        throw new Error(
          `Canvas does not expose a usable pointer target in this WebView: ${JSON.stringify(
            canvasInfo,
          )}`,
        );
      }
      // Prefer the real toolbar control, then use the rectangle shortcut if this version labels it differently.
      const rectangleTool =
        root.querySelector<HTMLButtonElement>(
          '[data-testid="toolbar-rectangle"]',
        ) ??
        Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
          (item) =>
            /rectangle/i.test(
              `${item.getAttribute("aria-label") ?? ""} ${item.title} ${
                item.getAttribute("data-testid") ?? ""
              }`,
            ),
        );
      if (rectangleTool) {
        rectangleTool.click();
      } else {
        doc.dispatchEvent(
          new win.KeyboardEvent("keydown", { key: "r", bubbles: true }),
        );
      }
      await delay(win, 150);
      const x1 = bounds.left + Math.max(40, bounds.width * 0.35);
      const y1 = bounds.top + Math.max(40, bounds.height * 0.35);
      const x2 = x1 + 90;
      const y2 = y1 + 70;
      const send = (type: string, x: number, y: number, buttons: number) =>
        canvas.dispatchEvent(
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
      send("pointerdown", x1, y1, 1);
      send("pointermove", (x1 + x2) / 2, (y1 + y2) / 2, 1);
      send("pointermove", x2, y2, 1);
      send("pointerup", x2, y2, 0);
      await delay(win, 300);
      return {
        target: "rendered Excalidraw canvas",
        gesture: "rectangle toolbar/shortcut + pointerdown/move/up",
        caveat:
          "synthetic WebView events do not prove physical-device input parity",
      };
    });

    await softStep("save-and-native-source-assertion", async () => {
      doc.dispatchEvent(
        new win.KeyboardEvent("keydown", {
          key: "s",
          metaKey: true,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      // SaveCoordinator debounce is 600ms; allow editor serialization plus IPC commit and watcher settle.
      await delay(win, 2200);
      let read = await call("read_drawing", {
        handle: activeVault.handle,
        path: `${nested}/ui-edited.excalidraw`,
      });
      let parsed = JSON.parse(read.json) as {
        type?: unknown;
        version?: unknown;
        elements?: Array<{ isDeleted?: boolean; type?: string }>;
        appState?: unknown;
        files?: unknown;
      };
      let live = (parsed.elements ?? []).filter(
        (element) => !element.isDeleted,
      );
      if (!live.some((element) => element.type === "rectangle")) {
        // One bounded retry after brief delay in case dirty check or debounce was in flight
        await delay(win, 1500);
        read = await call("read_drawing", {
          handle: activeVault.handle,
          path: `${nested}/ui-edited.excalidraw`,
        });
        parsed = JSON.parse(read.json) as {
          type?: unknown;
          version?: unknown;
          elements?: Array<{ isDeleted?: boolean; type?: string }>;
          appState?: unknown;
          files?: unknown;
        };
        live = (parsed.elements ?? []).filter((element) => !element.isDeleted);
      }
      if (
        parsed.type !== "excalidraw" ||
        !Number.isFinite(parsed.version) ||
        !Array.isArray(parsed.elements) ||
        !parsed.appState ||
        !parsed.files
      ) {
        throw new Error(
          "Saved source is not a structurally valid Excalidraw scene",
        );
      }
      if (
        !live.length ||
        !live.some((element) => element.type === "rectangle")
      ) {
        throw new Error(
          "Saved source has no nondeleted rectangle; pointer drawing was not proven",
        );
      }
      return {
        path: `${nested}/ui-edited.excalidraw`,
        revision: read.revision,
        liveElementCount: live.length,
        source: "native read_drawing after UI Cmd/Ctrl+S and debounce",
      };
    });

    await softStep("canvas-text-typing-survives-autosave", async () => {
      // Synthetic taps are ignored by the text tool (it needs a genuine
      // pointerup), so use the keyboard path a user also has: select the
      // drawn rectangle and press Enter to edit its label.
      const key = (k: string, extra: KeyboardEventInit = {}) =>
        doc.dispatchEvent(
          new win.KeyboardEvent("keydown", {
            key: k,
            code: k.length === 1 ? `Key${k.toUpperCase()}` : k,
            bubbles: true,
            cancelable: true,
            ...extra,
          }),
        );
      const editor = () =>
        doc.querySelector<HTMLTextAreaElement>("textarea.excalidraw-wysiwyg");
      const docId = () =>
        root.querySelector(".vault-editor")?.getAttribute("data-document-id");
      const docIdBefore = docId();
      // Excalidraw commits the WYSIWYG editor on blur, and WebKit blurs the
      // focused element whenever the window stops being the key window (app
      // switch, a tiling window manager moving focus). That is upstream
      // behaviour and keeps the text, but it is not what this step tests, so
      // record focus changes and tell OS focus loss apart from an app bug.
      const focusLog: Array<Record<string, unknown>> = [];
      const t0 = win.performance.now();
      const onWindowBlur = () =>
        focusLog.push({
          event: "window-blur",
          ms: Math.round(win.performance.now() - t0),
        });
      const onFocusOut = (event: FocusEvent) => {
        if (
          (event.target as Element | null)?.matches?.(
            "textarea.excalidraw-wysiwyg",
          )
        ) {
          focusLog.push({
            event: "editor-blur",
            ms: Math.round(win.performance.now() - t0),
            windowFocused: doc.hasFocus(),
            to:
              (event.relatedTarget as Element | null)?.className?.toString() ??
              null,
          });
        }
      };
      win.addEventListener("blur", onWindowBlur);
      doc.addEventListener("focusout", onFocusOut, true);
      const openEditor = async () => {
        key("Escape");
        key("a", { metaKey: true, ctrlKey: true });
        await delay(win, 150);
        key("Enter");
        await delay(win, 300);
        if (!editor()) {
          throw new Error(
            `Enter on the selected rectangle did not open a text editor: ${JSON.stringify(
              {
                docIdBefore,
                docIdAfter: docId(),
                active: doc.activeElement?.className,
                hasFocus: doc.hasFocus(),
              },
            )}`,
          );
        }
        // A smoke-launched window may not be the key window, so focus may not
        // have been granted by the OS; focus explicitly as a user click would.
        if (doc.activeElement !== editor()) {
          editor()!.focus();
        }
        return doc.activeElement === editor();
      };
      const type = (text: string) => {
        const textarea = editor();
        if (!textarea) {
          throw new Error("WYSIWYG text editor closed while typing");
        }
        textarea.value += text;
        textarea.dispatchEvent(
          new win.InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: text,
          }),
        );
      };
      let focusedInitially = false;
      const osFocusLosses: Array<Record<string, unknown>> = [];
      try {
        focusedInitially = await openEditor();
        type("Smoke");
        for (let attempt = 1; ; attempt++) {
          const logged = focusLog.length;
          // Longer than the autosave debounce so the native write and its
          // watcher echo both land while the editor is still open.
          await delay(win, 3000);
          const open = !!editor();
          const focused = doc.activeElement === editor();
          if (open && (!focusedInitially || focused)) {
            break;
          }
          const events = focusLog.slice(logged);
          const diagnostics = JSON.stringify({
            attempt,
            editorOpen: open,
            docIdBefore,
            docIdAfter: docId(),
            active: doc.activeElement?.className?.toString().slice(0, 80),
            windowFocused: doc.hasFocus(),
            events,
          });
          if (docId() !== docIdBefore) {
            // The scene was reloaded under the editor: the real bug.
            throw new Error(
              `Text editor remounted during autosave: ${diagnostics}`,
            );
          }
          const osFocusLost = events.some(
            (e) => e.event === "window-blur" || e.windowFocused === false,
          );
          if (!osFocusLost) {
            throw new Error(
              `Text editor ${
                open ? "lost focus" : "closed"
              } after autosave without OS focus loss: ${diagnostics}`,
            );
          }
          osFocusLosses.push(JSON.parse(diagnostics));
          if (attempt >= 3) {
            throw new Error(
              `The window kept losing OS focus while the text editor was open (environment, not autosave): ${diagnostics}`,
            );
          }
          // Reopen the label: the blur committed it, nothing typed is lost.
          if (!open || !focused) {
            key("Escape");
            await delay(win, 100);
            await openEditor();
          }
          if (editor()!.value !== "Smoke") {
            throw new Error(
              `Typed text lost after OS focus loss: ${JSON.stringify(
                editor()!.value,
              )}`,
            );
          }
        }
      } finally {
        win.removeEventListener("blur", onWindowBlur);
        doc.removeEventListener("focusout", onFocusOut, true);
      }
      type(" text");
      editor()!.dispatchEvent(
        new win.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await delay(win, 2500);
      const read = await call("read_drawing", {
        handle: activeVault.handle,
        path: `${nested}/ui-edited.excalidraw`,
      });
      const texts = (
        (JSON.parse(read.json).elements ?? []) as Array<{
          type?: string;
          originalText?: string;
          isDeleted?: boolean;
        }>
      )
        .filter((element) => element.type === "text" && !element.isDeleted)
        // `text` is wrapped to the container width; compare what was typed.
        .map((element) => element.originalText);
      if (!texts.includes("Smoke text")) {
        throw new Error(
          `Saved source lacks typed text: ${JSON.stringify(texts)}`,
        );
      }
      return {
        savedTexts: texts,
        focusedInitially,
        osFocusLosses,
        gesture: "select rectangle + Enter",
        caveat:
          "text inserted via input events on the real WYSIWYG textarea, not OS keystrokes",
      };
    });

    await softStep("ui-switch-and-reopen-saved-drawing", async () => {
      const reopened = await call("reopen_vault");
      if (reopened !== null) {
        throw new Error(
          "Smoke reopen_vault must return None to keep onboarding deterministic",
        );
      }
      button("Close current vault and open another").click();
      await waitFor(
        "vault remains configured after UI switch",
        () =>
          root.querySelector<HTMLElement>("[data-vault-path]")?.dataset
            .vaultPath === activeVault.path,
      );
      const search = root.querySelector<HTMLInputElement>(
        '[placeholder^="Search drawings"]',
      );
      if (!search) {
        throw new Error("Tree search input missing");
      }
      const setter = Object.getOwnPropertyDescriptor(
        win.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(search, "ui-edited");
      search.dispatchEvent(new win.Event("input", { bubbles: true }));
      // Pick the suite's own drawing by full path: a restart keeps earlier runs'
      // files (smoke-exports/ui-edited.excalidraw), which also match "ui-edited"
      // and can rank first.
      const uiPath = `${nested}/ui-edited.excalidraw`;
      const resultFor = () =>
        Array.from(
          root.querySelectorAll<HTMLElement>(
            '.vault-search-row[data-kind="drawing"]',
          ),
        ).find(
          (item) =>
            item.querySelector<HTMLElement>(".vault-search-row__name")
              ?.title === uiPath,
        );
      await waitFor("search result", resultFor);
      const result = resultFor();
      if (!result) {
        throw new Error("Search result disappeared before click");
      }
      result.click();
      await waitFor("reopened editor document", () =>
        root
          .querySelector<HTMLElement>(".vault-editor")
          ?.getAttribute("data-document-id"),
      );
      await waitFor("reopened the suite drawing", () =>
        root.querySelector<HTMLElement>(
          ".vault-tree-item--active .vault-tree-item__name",
        )?.title === uiPath
          ? true
          : null,
      );
      return {
        path: `${nested}/ui-edited.excalidraw`,
        actions:
          "native reopen check + UI switch button + tree search + result open",
      };
    });

    // ---- Tree drag and drop (pointer-based, components/tree/useTreeDrag.ts) ----
    await softStep("ui-tree-drag-drop", async () => {
      const suite = `smoke-suite-${runId}`;
      const target = `${suite}/dnd-target`;
      const drawing = `${nested}/ui-edited.excalidraw`;
      const moved = `${target}/ui-edited.excalidraw`;
      const clear = root.querySelector<HTMLButtonElement>(
        '[aria-label="Clear search"]',
      );
      clear?.click();
      await call("create_folder", { handle: activeVault.handle, path: target });
      await runPaletteCommand("navigator: refresh files");
      const row = (path: string) =>
        root.querySelector<HTMLElement>(
          `.vault-tree-item[data-tree-path="${win.CSS.escape(path)}"]`,
        );
      await waitFor("drop target folder row", () => row(target));
      await waitFor("open drawing row", () => row(drawing));
      const pointer = (el: Element, type: string, x: number, y: number) =>
        el.dispatchEvent(
          new win.PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            // WebKit only lets the real mouse id (1) take pointer capture.
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: x,
            clientY: y,
          }),
        );
      /** Drags a tree row onto another row; returns the ghost state seen over it. */
      const dragRow = async (fromPath: string, toPath: string) => {
        const from = row(fromPath);
        const to = row(toPath);
        if (!from || !to) {
          throw new Error(`Drag rows missing: ${fromPath} -> ${toPath}`);
        }
        from.scrollIntoView({ block: "center" });
        const a = from.getBoundingClientRect();
        const sx = a.left + 24;
        const sy = a.top + a.height / 2;
        pointer(from, "pointerdown", sx, sy);
        to.scrollIntoView({ block: "nearest" });
        const b = to.getBoundingClientRect();
        const tx = b.left + 24;
        const ty = b.top + b.height / 2;
        for (let i = 1; i <= 6; i++) {
          const x = sx + ((tx - sx) * i) / 6;
          const y = sy + ((ty - sy) * i) / 6;
          pointer(doc.elementFromPoint(x, y) ?? doc.body, "pointermove", x, y);
          await delay(win, 16);
        }
        await delay(win, 50);
        const ghost = doc.querySelector<HTMLElement>(".vault-tree-drag-ghost");
        const seen = {
          ghost: Boolean(ghost),
          allowed: ghost?.dataset.allowed ?? null,
          hint: ghost?.textContent ?? null,
          highlighted: Boolean(
            row(toPath)?.classList.contains("vault-tree-item--drop-target"),
          ),
        };
        pointer(doc.elementFromPoint(tx, ty) ?? doc.body, "pointerup", tx, ty);
        await delay(win, 50);
        return seen;
      };
      const names = async (path: string) =>
        (
          await call("list_directory", { handle: activeVault.handle, path })
        ).map((entry) => entry.path);
      const liveRectangles = async (path: string) => {
        const read = await call("read_drawing", {
          handle: activeVault.handle,
          path,
        });
        const parsed = JSON.parse(read.json) as {
          elements?: Array<{ isDeleted?: boolean; type?: string }>;
        };
        return (parsed.elements ?? []).filter(
          (element) => !element.isDeleted && element.type === "rectangle",
        ).length;
      };

      // 1. The open drawing into another folder.
      const before = await liveRectangles(drawing);
      const intoFolder = await dragRow(drawing, target);
      if (intoFolder.allowed !== "true" || !intoFolder.highlighted) {
        throw new Error(
          `Drop onto folder not offered: ${JSON.stringify(intoFolder)}`,
        );
      }
      const until = win.performance.now() + timeout;
      while (!(await names(target)).includes(moved)) {
        if (win.performance.now() > until) {
          throw new Error("Dragged drawing never arrived in the target folder");
        }
        await delay(win, 100);
      }
      if ((await names(nested)).includes(drawing)) {
        throw new Error("Dragged drawing still exists at its old path");
      }
      await waitFor("editor follows the moved drawing", () =>
        root.querySelector<HTMLElement>(
          ".vault-tree-item--active .vault-tree-item__name",
        )?.title === moved && root.querySelector(".vault-editor canvas")
          ? true
          : null,
      );

      // 2. Editing after the move saves to the new path.
      const canvas = root.querySelector<HTMLCanvasElement>(
        ".vault-editor canvas.interactive",
      );
      const rectangleTool = root.querySelector<HTMLElement>(
        '[data-testid="toolbar-rectangle"]',
      );
      if (!canvas || !rectangleTool) {
        throw new Error("Editor canvas/tools missing after move");
      }
      rectangleTool.click();
      await delay(win, 150);
      const box = canvas.getBoundingClientRect();
      const x1 = box.left + box.width * 0.55;
      const y1 = box.top + box.height * 0.55;
      pointer(canvas, "pointerdown", x1, y1);
      pointer(canvas, "pointermove", x1 + 40, y1 + 30);
      pointer(canvas, "pointermove", x1 + 80, y1 + 60);
      pointer(canvas, "pointerup", x1 + 80, y1 + 60);
      doc.dispatchEvent(
        new win.KeyboardEvent("keydown", {
          key: "s",
          metaKey: true,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      const saveUntil = win.performance.now() + timeout;
      let after = await liveRectangles(moved);
      while (after <= before && win.performance.now() < saveUntil) {
        await delay(win, 250);
        after = await liveRectangles(moved);
      }
      if (after <= before) {
        throw new Error(
          `Edit after move did not save to the new path (${before} -> ${after})`,
        );
      }
      if ((await names(nested)).includes(drawing)) {
        throw new Error("A save after the move recreated the old path");
      }

      // 3. Blocked: a folder into its own descendant changes nothing.
      const blocked = await dragRow(suite, nested);
      if (blocked.allowed !== "false" || blocked.highlighted) {
        throw new Error(
          `Descendant drop was not blocked: ${JSON.stringify(blocked)}`,
        );
      }
      await delay(win, 300);
      if (!(await names(suite)).includes(nested)) {
        throw new Error("Blocked drop changed the tree");
      }

      // 4. Move it back so later steps see the original layout.
      const back = await dragRow(moved, nested);
      if (back.allowed !== "true") {
        throw new Error(`Drop back not offered: ${JSON.stringify(back)}`);
      }
      const backUntil = win.performance.now() + timeout;
      while (!(await names(nested)).includes(drawing)) {
        if (win.performance.now() > backUntil) {
          throw new Error("Drawing did not move back");
        }
        await delay(win, 100);
      }
      return {
        moved,
        rectanglesBeforeAfter: [before, after],
        intoFolder,
        blocked,
        method:
          "synthetic pointer events on tree rows (pointer DnD), native list/read assertions",
      };
    });

    // ---- Canvas file drop (HTML5 drop in WKWebView; native interception is off) ----
    await softStep("ui-canvas-file-drop", async () => {
      const path = `${nested}/ui-edited.excalidraw`;
      const readLive = async () => {
        const read = await call("read_drawing", {
          handle: activeVault.handle,
          path,
        });
        const parsed = JSON.parse(read.json) as {
          elements?: Array<{ isDeleted?: boolean; type?: string }>;
        };
        return (parsed.elements ?? []).filter((e) => !e.isDeleted);
      };
      const target = await waitFor(
        "excalidraw drop target",
        () => root.querySelector<HTMLElement>(".vault-editor .excalidraw"),
        5000,
      );
      const rect = target.getBoundingClientRect();
      const drop = (file: File) => {
        const dataTransfer = new win.DataTransfer();
        dataTransfer.items.add(file);
        const init = {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        };
        target.dispatchEvent(new win.DragEvent("dragenter", init));
        target.dispatchEvent(new win.DragEvent("dragover", init));
        target.dispatchEvent(new win.DragEvent("drop", init));
      };
      const before = (await readLive()).length;
      // A scene file must not replace the open drawing (VaultEditor guard).
      drop(
        new win.File(
          ['{"type":"excalidraw","elements":[]}'],
          "other.excalidraw",
          {
            type: "application/vnd.excalidraw+json",
          },
        ),
      );
      await delay(win, 800);
      // 1x1 PNG, inserted as an image element.
      const bytes = Uint8Array.from(
        win.atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        ),
        (c) => c.charCodeAt(0),
      );
      drop(new win.File([bytes], "dropped.png", { type: "image/png" }));
      let live = await readLive();
      const until = win.performance.now() + 8000;
      while (!live.some((e) => e.type === "image")) {
        if (win.performance.now() > until) {
          throw new Error("Dropped PNG did not become an image element");
        }
        doc.dispatchEvent(
          new win.KeyboardEvent("keydown", {
            key: "s",
            metaKey: true,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
        await delay(win, 1200);
        live = await readLive();
      }
      if (live.length !== before + 1) {
        throw new Error(
          `Expected exactly one new element after the drops, got ${
            live.length - before
          }`,
        );
      }
      // Leave the drawing as it was: images cannot be added to the library, so a
      // leftover image would make the later "select all, add to library" step fail.
      // The inserted image is the selection; delete it and save.
      doc.dispatchEvent(
        new win.KeyboardEvent("keydown", {
          key: "Delete",
          bubbles: true,
          cancelable: true,
        }),
      );
      const cleanupUntil = win.performance.now() + 8000;
      while ((await readLive()).length !== before) {
        if (win.performance.now() > cleanupUntil) {
          throw new Error("Dropped image was not removed after the drop step");
        }
        doc.dispatchEvent(
          new win.KeyboardEvent("keydown", {
            key: "s",
            metaKey: true,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
        await delay(win, 1200);
      }
      return {
        before,
        after: live.length,
        method:
          "synthetic HTML5 drop events with DataTransfer files; native dragDropEnabled=false verified in tauri.conf.json",
      };
    });

    // ---- Thumbnail disk cache + vdthumb:// scheme (real Rust store, real scheme handler) ----
    // Before the library UI steps: it needs only the vault, and a later UI failure must
    // not hide whether thumbnails load (CSP, scheme handler).
    await runThumbnailsSmoke({
      win,
      doc,
      handle: activeVault.handle,
      drawingPath: filePath,
      step: softStep,
    });

    // ---- Persisted library (F10): phase decided by the personal file, see librarySmoke.ts ----
    // Library item previews are SVG exports too: same known inline-style CSP reports.
    svgExportInFlight = true;
    await runLibrarySmoke({
      root,
      doc,
      win,
      handle: activeVault.handle,
      startedAt,
      step: softStep,
      waitFor,
      invoke: invokeNative,
    }).finally(() => {
      svgExportInFlight = false;
    });

    // ---- Config folder (personal/planning/config.md) ----
    await softStep("config-loaded", async () => {
      const loaded = await call("load_settings");
      const status = getSettingsStatus();
      if (status.mode !== "tauri") {
        throw new Error(
          `Settings are not backed by the config folder: ${JSON.stringify(
            status,
          )}`,
        );
      }
      if (/\/\.config\/vaultdraw\/?$/.test(loaded.configDir)) {
        throw new Error(
          `Smoke run is using the real config dir: ${loaded.configDir}`,
        );
      }
      if (loaded.configPath !== `${loaded.configDir}/config.toml`) {
        throw new Error(
          `configPath ${loaded.configPath} is not inside ${loaded.configDir}`,
        );
      }
      if (!loaded.statePath.endsWith("/state.json")) {
        throw new Error(`Unexpected statePath ${loaded.statePath}`);
      }
      if (loaded.configError !== null || loaded.config === null) {
        throw new Error(
          `Default config did not parse: ${JSON.stringify(loaded.configError)}`,
        );
      }
      const mismatches = diffConfig(DEFAULT_CONFIG_JSON, loaded.config);
      if (mismatches.length) {
        throw new Error(`Config is not the default: ${mismatches.join("; ")}`);
      }
      if (status.problems.length) {
        throw new Error(
          `Settings problems on a default config: ${JSON.stringify(
            status.problems,
          )}`,
        );
      }
      const prefs = getPreferences(win);
      const prefMismatches = (
        [
          "theme",
          "colorTheme",
          "syncCanvas",
          "defaultCanvasBackground",
          "defaultFontFamily",
          "defaultFontSize",
          "defaultStrokeColor",
          "defaultBackgroundColor",
          "defaultFillStyle",
          "defaultStrokeWidth",
          "defaultRoughness",
          "autosaveDelayMs",
        ] as Array<keyof VaultPreferences>
      ).filter((key) => prefs[key] !== DEFAULT_PREFERENCES[key]);
      if (prefMismatches.length) {
        throw new Error(
          `In-memory preferences differ from defaults: ${prefMismatches.join(
            ", ",
          )}`,
        );
      }
      return {
        configDir: loaded.configDir,
        configPath: loaded.configPath,
        statePath: loaded.statePath,
        state: loaded.state,
      };
    });

    // Records the zoom the app booted with. For the two-run restart check
    // (see the smoke handbook): set interface.zoom in the config dir, relaunch,
    // and compare the native window width with innerWidth.
    await softStep("startup-zoom", async () => {
      const loaded = await call("load_settings");
      const configured =
        ((loaded.config as Record<string, Record<string, unknown>> | null)
          ?.interface?.zoom as number | undefined) ?? 100;
      // outerWidth is 0 in the WKWebView, so take the unzoomed width from the
      // native window: logical width / CSS innerWidth = the applied zoom.
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const native = getCurrentWindow();
      const [size, scale] = await Promise.all([
        native.innerSize(),
        native.scaleFactor(),
      ]);
      const logicalWidth = size.width / scale;
      const ratio = logicalWidth / win.innerWidth;
      const expected = configured / 100;
      if (Math.abs(ratio - expected) > 0.05 * expected) {
        throw new Error(
          `Startup zoom not applied: configured ${configured}%, native/CSS width ratio ${ratio.toFixed(
            3,
          )} (CSS inner ${
            win.innerWidth
          }, native logical ${logicalWidth}, dpr ${win.devicePixelRatio})`,
        );
      }
      return {
        configuredZoom: configured,
        prefZoom: getPreferences(win).zoom,
        innerWidth: win.innerWidth,
        nativeLogicalWidth: logicalWidth,
        devicePixelRatio: win.devicePixelRatio,
        nativeOverCssWidth: Number(ratio.toFixed(3)),
      };
    });

    await softStep("config-gui-write-preserves-comments", async () => {
      button("Settings").click();
      const modal = await waitFor("settings modal", () =>
        doc.querySelector<HTMLElement>(".vault-settings-modal"),
      );
      const modalButton = (text: string) =>
        Array.from(modal.querySelectorAll<HTMLButtonElement>("button")).find(
          (item) => item.textContent?.trim() === text,
        ) ?? null;
      (
        await waitFor("Appearance tab", () => modalButton("Appearance"))
      ).click();
      (await waitFor("Dark theme button", () => modalButton("Dark"))).click();
      (await waitFor("General tab", () => modalButton("General"))).click();
      const configRow = await waitFor("config path row", () =>
        modal.querySelector<HTMLElement>('[data-testid="settings-config-row"]'),
      );
      const shownPath =
        configRow.querySelector(".vault-config-path")?.textContent ?? null;
      (await waitFor("Files tab", () => modalButton("Files"))).click();
      // Autosave delay is a stepper (span[role=spinbutton] + Increase/Decrease
      // buttons, 50 ms per step); click until it reads 1000, as a user would.
      const stepper = await waitFor("autosave stepper", () =>
        modal.querySelector<HTMLElement>(
          '[role="spinbutton"][aria-label="Autosave delay"]',
        ),
      );
      for (let i = 0; i < 40; i++) {
        const now = Number(stepper.getAttribute("aria-valuenow"));
        if (now === 1000) {
          break;
        }
        modal
          .querySelector<HTMLButtonElement>(
            `[aria-label="${
              now < 1000 ? "Increase" : "Decrease"
            } Autosave delay"]`,
          )
          ?.click();
        await delay(win, 50);
      }
      if (stepper.getAttribute("aria-valuenow") !== "1000") {
        throw new Error(
          `Autosave stepper stuck at ${stepper.getAttribute("aria-valuenow")}`,
        );
      }
      if (getPreferences(win).autosaveDelayMs !== 1000) {
        throw new Error("Autosave stepper did not update preferences");
      }
      if (!doc.documentElement.classList.contains("dark")) {
        throw new Error("Dark theme button did not apply the dark class");
      }
      const expected = withConfig({
        appearance: { mode: "dark" },
        saving: { autosave_delay_ms: 1000 },
      });
      let loaded = await call("load_settings");
      const until = win.performance.now() + 3000;
      while (
        diffConfig(expected, loaded.config).length &&
        win.performance.now() < until
      ) {
        await delay(win, 100);
        loaded = await call("load_settings");
      }
      const mismatches = diffConfig(expected, loaded.config);
      if (mismatches.length) {
        throw new Error(
          `GUI edits not written to config.toml: ${mismatches.join("; ")}`,
        );
      }
      (
        await waitFor("Close Settings", () =>
          modal.querySelector<HTMLButtonElement>(
            '[aria-label="Close Settings"]',
          ),
        )
      ).click();
      await waitFor("settings modal closed", () =>
        doc.querySelector(".vault-settings-modal") ? null : true,
      );
      // Let our own write's config-change echo settle before the next step.
      await delay(win, 600);
      return {
        shownPath,
        method:
          "Settings UI: Appearance > Dark, General > config path, Files > autosave stepper to 1000",
        commentsCheck:
          "no native file-read smoke helper; comments verified by the operator reading config.toml after the run",
      };
    });

    await softStep("config-external-edit-live-reload", async () => {
      let received: VaultPreferences | null = null;
      const onChanged = (event: Event) => {
        const detail = (event as CustomEvent<VaultPreferences>).detail;
        if (detail?.autosaveDelayMs === 1500) {
          received = detail;
        }
      };
      win.addEventListener(PREFERENCES_CHANGED_EVENT, onChanged);
      const startedAt = win.performance.now();
      try {
        await call("update_config", {
          changes: [{ key: "saving.autosave_delay_ms", value: 1500 }],
        });
        await waitFor(
          "vault-preferences-changed with 1500",
          () => received,
          2000,
        );
      } finally {
        win.removeEventListener(PREFERENCES_CHANGED_EVENT, onChanged);
      }
      const latencyMs = Math.round(win.performance.now() - startedAt);
      if (getPreferences(win).autosaveDelayMs !== 1500) {
        throw new Error("In-memory autosaveDelayMs not updated to 1500");
      }
      if (getPreferences(win).theme !== "dark") {
        throw new Error("Unrelated preference (theme) changed on reload");
      }
      return { latencyMs, autosaveDelayMs: 1500 };
    });

    await softStep("config-invalid-value-banner", async () => {
      let lastStatus: SettingsStatus | null = null;
      const onStatus = (event: Event) => {
        lastStatus = (event as CustomEvent<SettingsStatus>).detail;
      };
      win.addEventListener(SETTINGS_STATUS_EVENT, onStatus);
      try {
        await call("update_config", {
          changes: [{ key: "appearance.mode", value: "neon" }],
        });
        const banner = await waitFor(
          "settings problem banner",
          () => {
            const alert = doc.querySelector<HTMLElement>(".vault-global-alert");
            return alert?.textContent?.includes("appearance.mode")
              ? alert.textContent
              : null;
          },
          3000,
        );
        const fallbackTheme = getPreferences(win).theme;
        if (fallbackTheme !== "system") {
          throw new Error(
            `Invalid mode should fall back to "system", got ${fallbackTheme}`,
          );
        }
        if (getPreferences(win).autosaveDelayMs !== 1500) {
          throw new Error("Valid fields must keep their values");
        }
        await call("update_config", {
          changes: [{ key: "appearance.mode", value: "dark" }],
        });
        await waitFor(
          "banner cleared after fix",
          () => {
            const alert = doc.querySelector<HTMLElement>(".vault-global-alert");
            return alert?.textContent?.includes("appearance.mode")
              ? null
              : true;
          },
          3000,
        );
        await waitFor(
          "theme back to dark",
          () => (getPreferences(win).theme === "dark" ? true : null),
          3000,
        );
        return {
          banner: banner.trim(),
          fallbackTheme,
          statusProblemsAfterFix: getSettingsStatus().problems,
          sawStatusEvent: lastStatus !== null,
        };
      } finally {
        win.removeEventListener(SETTINGS_STATUS_EVENT, onStatus);
      }
    });

    await softStep("config-hotkey-key-roundtrip", async () => {
      const key = "hotkeys.vault.newDrawing";
      await call("update_config", { changes: [{ key, value: ["Mod+N"] }] });
      const written = await call("load_settings");
      const hotkeys = (written.config as Record<string, unknown> | null)
        ?.hotkeys as Record<string, unknown> | undefined;
      if (JSON.stringify(hotkeys?.["vault.newDrawing"]) !== '["Mod+N"]') {
        throw new Error(
          `hotkeys["vault.newDrawing"] not written: ${JSON.stringify(hotkeys)}`,
        );
      }
      await call("update_config", { changes: [{ key, value: null }] });
      const removed = await call("load_settings");
      const after = (removed.config as Record<string, unknown> | null)
        ?.hotkeys as Record<string, unknown> | undefined;
      if (!after || Object.keys(after).length) {
        throw new Error(
          `hotkeys not empty after removal: ${JSON.stringify(after)}`,
        );
      }
      if (removed.configError) {
        throw new Error(
          `config error after removal: ${JSON.stringify(removed.configError)}`,
        );
      }
      // Let the config-change echo settle before the next step.
      await delay(win, 600);
      return { written: hotkeys, afterRemoval: after };
    });

    await softStep("vault-settings-roundtrip", async () => {
      const handle = vault.handle;
      const initial = await call("load_vault_settings", { handle });
      if (initial.settingsError || JSON.stringify(initial.settings) !== "{}") {
        throw new Error(
          `Fresh vault settings are not {}: ${JSON.stringify(initial)}`,
        );
      }
      const { listen } = await import("@tauri-apps/api/event");
      let eventAt: number | null = null;
      const off = await listen("vault-settings-change", (event) => {
        const payload = event.payload as { handle?: string };
        if (payload.handle === handle && eventAt === null) {
          eventAt = win.performance.now();
        }
      });
      const startedAt = win.performance.now();
      let written: Awaited<ReturnType<Native["load_vault_settings"]>>;
      try {
        await call("update_vault_settings", {
          handle,
          changes: [{ key: "files.new_drawing_folder", value: "Inbox" }],
        });
        written = await call("load_vault_settings", { handle });
        const files = written.settings?.files as
          | Record<string, unknown>
          | undefined;
        if (files?.new_drawing_folder !== "Inbox") {
          throw new Error(
            `new_drawing_folder not written: ${JSON.stringify(written)}`,
          );
        }
        await waitFor(
          "vault-settings-change for this vault",
          () => eventAt,
          2000,
        );
      } finally {
        off();
      }
      const eventLatencyMs = Math.round((eventAt ?? startedAt) - startedAt);
      await call("update_vault_settings", {
        handle,
        changes: [{ key: "files.new_drawing_folder", value: null }],
      });
      const removed = await call("load_vault_settings", { handle });
      const removedFiles = removed.settings?.files as
        | Record<string, unknown>
        | undefined;
      if (
        removed.settingsError ||
        removedFiles?.new_drawing_folder !== undefined
      ) {
        throw new Error(
          `new_drawing_folder not removed: ${JSON.stringify(removed)}`,
        );
      }
      // Let the removal's watcher event settle before the next step.
      await delay(win, 800);
      return {
        path: written.path,
        initial: initial.settings,
        written: written.settings,
        afterRemoval: removed.settings,
        eventLatencyMs,
      };
    });

    await softStep("settings-cmd-comma", async () => {
      if (doc.querySelector(".vault-settings-modal")) {
        throw new Error("Settings modal already open before Cmd+,");
      }
      const event = new win.KeyboardEvent("keydown", {
        key: ",",
        code: "Comma",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      doc.dispatchEvent(event);
      const modal = await waitFor(
        "settings modal via Cmd+,",
        () => doc.querySelector<HTMLElement>(".vault-settings-modal"),
        3000,
      );
      const search = await waitFor("settings search field", () =>
        modal.querySelector<HTMLInputElement>(".vault-settings-search__input"),
      );
      const searchFocused = await waitFor(
        "settings search focused",
        () => (doc.activeElement === search ? true : null),
        2000,
      ).catch(() => false);
      (
        await waitFor("Close Settings", () =>
          modal.querySelector<HTMLButtonElement>(
            '[aria-label="Close Settings"]',
          ),
        )
      ).click();
      await waitFor("settings modal closed", () =>
        doc.querySelector(".vault-settings-modal") ? null : true,
      );
      return {
        defaultPrevented: event.defaultPrevented,
        searchFocused,
      };
    });

    // ---- Hotkeys (Settings phase 3) ----
    // Synthetic keydowns reach the window dispatcher like real keys; native
    // menu key equivalents are not exercised (operator check: press Cmd+P).
    const pressKey = (init: KeyboardEventInit, target: EventTarget = doc) => {
      const event = new win.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(event);
      return event;
    };
    const navigatorWidth = () =>
      doc
        .querySelector('[aria-label="Vault File Navigator"]')
        ?.getBoundingClientRect().width ?? 0;

    await softStep("hotkeys-config-hand-edit-live", async () => {
      const key = "hotkeys.view.toggleNavigator";
      const chord = { key: "b", code: "KeyB", metaKey: true, altKey: true };
      const startedAt = win.performance.now();
      await call("update_config", {
        changes: [{ key, value: ["Mod+Alt+B"] }],
      });
      await waitFor(
        "[hotkeys] edit applied to preferences",
        () =>
          getPreferences(win).hotkeys["view.toggleNavigator"]?.[0] ===
          "Mod+Alt+B"
            ? true
            : null,
        4000,
      );
      const reloadMs = Math.round(win.performance.now() - startedAt);
      const before = navigatorWidth();
      try {
        const event = pressKey(chord);
        await waitFor(
          "navigator hidden by the new chord",
          () => (navigatorWidth() < 2 ? true : null),
          3000,
        );
        pressKey(chord);
        await waitFor(
          "navigator shown again",
          () => (navigatorWidth() > 100 ? true : null),
          3000,
        );
        return {
          reloadMs,
          widthBefore: before,
          claimed: event.defaultPrevented,
        };
      } finally {
        await call("update_config", { changes: [{ key, value: null }] });
        await waitFor(
          "[hotkeys] override removed",
          () =>
            getPreferences(win).hotkeys["view.toggleNavigator"] ? null : true,
          4000,
        );
      }
    });

    await softStep("hotkeys-cmd-p-command-palette", async () => {
      const dialog = () =>
        doc.querySelector<HTMLElement>(
          '[role="dialog"][aria-label="Command palette"]',
        );
      if (dialog()) {
        throw new Error("Command palette already open");
      }
      const startedAt = win.performance.now();
      const event = pressKey({ key: "p", code: "KeyP", metaKey: true });
      const input = await waitFor("command palette input", () =>
        dialog()?.querySelector<HTMLInputElement>(".vault-quick__input"),
      );
      await waitFor(
        "first command palette row",
        () => dialog()?.querySelector(".vault-quick__row"),
        3000,
      );
      const openMs = Math.round(win.performance.now() - startedAt);
      const inputFocused = doc.activeElement === input;
      // Type a query the way the input sees it and time the commit.
      const setter = Object.getOwnPropertyDescriptor(
        win.HTMLInputElement.prototype,
        "value",
      )!.set!;
      const keystrokeMs: number[] = [];
      for (const text of [">", ">o", ">op", ">open set"]) {
        setter.call(input, text);
        const t0 = win.performance.now();
        input.dispatchEvent(new win.Event("input", { bubbles: true }));
        keystrokeMs.push(+(win.performance.now() - t0).toFixed(2));
      }
      const firstRow = await waitFor("command row for >open set", () => {
        const row = dialog()?.querySelector(".vault-quick__row");
        return row?.textContent?.includes("Open settings")
          ? row.textContent
          : null;
      });
      const toast = !!doc.querySelector(".Toast");
      pressKey({ key: "Escape", code: "Escape" }, input);
      await waitFor("command palette closed", () => (dialog() ? null : true));
      if (!event.defaultPrevented) {
        throw new Error("Cmd+P was not claimed (the webview would print)");
      }
      if (!inputFocused) {
        throw new Error("Command palette input not focused after Cmd+P");
      }
      if (toast) {
        throw new Error("Excalidraw's command palette toast appeared");
      }
      return { openMs, keystrokeMs, firstRow };
    });

    // ---- Settings phase 2 (accent, zoom, per-vault settings, default folder) ----
    // The webview cannot write config.toml / settings.toml directly, so "hand
    // edits" go through update_config / update_vault_settings: both rewrite the
    // file on disk and the app picks the change up through the file watcher,
    // the same path an editor save takes.
    const cssPrimary = () =>
      win
        .getComputedStyle(doc.documentElement)
        .getPropertyValue("--vault-primary")
        .trim();
    const waitPrefs = (
      label: string,
      test: (prefs: PreferencesSnapshot) => boolean,
      ms = 4000,
    ) => waitFor(label, () => (test(getPreferences(win)) ? true : null), ms);
    const pollAsync = async <T>(
      label: string,
      read: () => Promise<T | null>,
      ms: number,
    ): Promise<T> => {
      const until = win.performance.now() + ms;
      while (win.performance.now() < until) {
        const result = await read();
        if (result !== null) {
          return result;
        }
        await delay(win, 250);
      }
      throw new Error(`Timed out after ${ms}ms waiting for ${label}`);
    };
    const resetPhase2Config = async () => {
      await call("update_config", {
        changes: [
          { key: "appearance.accent_color", value: null },
          { key: "interface.zoom", value: null },
          { key: "navigator.sort", value: null },
          { key: "files.confirm_delete", value: null },
          { key: "files.new_drawing_folder", value: null },
        ],
      });
      await waitPrefs(
        "phase 2 defaults restored",
        (p) =>
          p.accentColor === "" &&
          p.zoom === 100 &&
          p.navigatorSort === DEFAULT_PREFERENCES.navigatorSort &&
          p.confirmDelete === true,
      );
    };

    await softStep("settings-phase2-config-live", async () => {
      const primaryBefore = cssPrimary();
      const startedAt = win.performance.now();
      await call("update_config", {
        changes: [
          { key: "appearance.accent_color", value: "#336699" },
          { key: "interface.zoom", value: 110 },
          { key: "navigator.sort", value: "name_desc" },
          { key: "files.confirm_delete", value: false },
        ],
      });
      try {
        await waitPrefs(
          "phase 2 preferences from config",
          (p) =>
            p.accentColor === "#336699" &&
            p.zoom === 110 &&
            p.navigatorSort === "name_desc" &&
            p.confirmDelete === false,
        );
        const latencyMs = Math.round(win.performance.now() - startedAt);
        const primaryAfter = await waitFor(
          "--vault-primary to change",
          () => {
            const now = cssPrimary();
            return now && now !== primaryBefore ? now : null;
          },
          3000,
        );
        const status = getSettingsStatus();
        if (status.problems.length) {
          throw new Error(
            `Valid phase 2 values raised problems: ${JSON.stringify(
              status.problems,
            )}`,
          );
        }
        return { latencyMs, primaryBefore, primaryAfter };
      } finally {
        await resetPhase2Config();
        await delay(win, 400);
      }
    });

    // ---- Pens and laser (F17): config -> pen bar, laser colour, highlighter ----
    await runPensSmoke({
      root,
      doc,
      win,
      handle: activeVault.handle,
      path: `${nested}/ui-edited.excalidraw`,
      step: softStep,
      waitFor,
      invoke: invokeNative,
    });

    await softStep("interface-zoom", async () => {
      const setZoomViaConfig = async (percent: number) => {
        await call("update_config", {
          changes: [{ key: "interface.zoom", value: percent }],
        });
        await waitPrefs(`zoom pref ${percent}`, (p) => p.zoom === percent);
      };
      const key = (code: string, shift: boolean, meta = true) => {
        const event = new win.KeyboardEvent("keydown", {
          key:
            code === "Equal"
              ? shift
                ? "+"
                : "="
              : code === "Minus"
              ? "-"
              : "0",
          code,
          metaKey: meta,
          shiftKey: shift,
          bubbles: true,
          cancelable: true,
        });
        doc.dispatchEvent(event);
        return event;
      };
      const base = { innerWidth: win.innerWidth, dpr: win.devicePixelRatio };
      const drawCheck = async () => {
        const activePath = await waitFor(
          "active drawing path",
          () =>
            root.querySelector<HTMLElement>(
              ".vault-tree-item--active .vault-tree-item__name",
            )?.title,
        );
        const canvas = await waitFor("canvas for pointer check", () => {
          const el = root.querySelector<HTMLCanvasElement>(
            ".vault-editor canvas.interactive",
          );
          const b = el?.getBoundingClientRect();
          return el && b && b.width >= 40 && b.height >= 40 ? el : null;
        });
        const bounds = canvas.getBoundingClientRect();
        const rectangleTool = root.querySelector<HTMLButtonElement>(
          '[data-testid="toolbar-rectangle"]',
        );
        if (!rectangleTool) {
          throw new Error("rectangle toolbar button not found");
        }
        rectangleTool.click();
        await delay(win, 150);
        const x1 = bounds.left + bounds.width * 0.5;
        const y1 = bounds.top + bounds.height * 0.5;
        const dx = 90;
        const dy = 70;
        const send = (type: string, x: number, y: number, buttons: number) =>
          canvas.dispatchEvent(
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
        // One event per frame, as real input arrives (and as the pens smoke
        // does): a whole drag inside one task can leave the rectangle 0x0.
        const frame = () =>
          new Promise<void>((resolve) =>
            win.requestAnimationFrame(() => resolve()),
          );
        send("pointerdown", x1, y1, 1);
        await frame();
        send("pointermove", x1 + dx / 2, y1 + dy / 2, 1);
        await frame();
        send("pointermove", x1 + dx, y1 + dy, 1);
        await frame();
        send("pointerup", x1 + dx, y1 + dy, 0);
        await delay(win, 300);
        doc.dispatchEvent(
          new win.KeyboardEvent("keydown", {
            key: "s",
            metaKey: true,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
        type Saved = {
          elements: Array<{
            type: string;
            isDeleted?: boolean;
            x: number;
            y: number;
            id?: string;
            width: number;
            height: number;
          }>;
          appState?: {
            scrollX?: number;
            scrollY?: number;
            zoom?: { value?: number };
          };
        };
        const readRects = async () => {
          const read = await call("read_drawing", {
            handle: activeVault.handle,
            path: activePath,
          });
          const saved = JSON.parse(read.json) as Saved;
          return {
            saved,
            rects: saved.elements.filter(
              (e) => e.type === "rectangle" && !e.isDeleted,
            ),
          };
        };
        // The earlier 100% rectangle is already saved; wait for one more.
        const beforeIds = new Set(
          (await readRects()).rects.map((r) => r.id ?? JSON.stringify(r)),
        );
        const { saved, fresh } = await pollAsync(
          "new rectangle saved",
          async () => {
            const r = await readRects();
            const added = r.rects.filter(
              (e) => !beforeIds.has(e.id ?? JSON.stringify(e)),
            );
            return added.length > 0 ? { saved: r.saved, fresh: added } : null;
          },
          8000,
        );
        const rect = fresh[fresh.length - 1];
        const canvasZoom = saved.appState?.zoom?.value ?? 1;
        const widthErr = Math.abs(rect.width * canvasZoom - dx);
        const heightErr = Math.abs(rect.height * canvasZoom - dy);
        const scrollX = saved.appState?.scrollX;
        const scrollY = saved.appState?.scrollY;
        let absErr: number | null = null;
        if (typeof scrollX === "number" && typeof scrollY === "number") {
          const ex = (x1 - bounds.left) / canvasZoom - scrollX;
          const ey = (y1 - bounds.top) / canvasZoom - scrollY;
          absErr = Math.max(
            Math.abs(rect.x - ex) * canvasZoom,
            Math.abs(rect.y - ey) * canvasZoom,
          );
        }
        return { widthErr, heightErr, absErr, canvasZoom, rect };
      };
      const at100 = await drawCheck();
      await setZoomViaConfig(150);
      const zoomed = await waitFor(
        "native webview zoom (innerWidth shrinks)",
        () =>
          win.innerWidth < base.innerWidth * 0.8
            ? {
                innerWidth: win.innerWidth,
                dpr: win.devicePixelRatio,
              }
            : null,
        6000,
      );
      const widthRatio = base.innerWidth / zoomed.innerWidth;
      if (Math.abs(widthRatio - 1.5) > 0.08) {
        throw new Error(
          `innerWidth ratio ${widthRatio.toFixed(3)} is not ~1.5 (base ${
            base.innerWidth
          }, zoomed ${zoomed.innerWidth}, dpr ${base.dpr} -> ${zoomed.dpr})`,
        );
      }
      await delay(win, 600); // let Excalidraw's resize observer settle

      const at150 = await drawCheck();
      const bad = (r: typeof at150) =>
        r.widthErr > 3 ||
        r.heightErr > 3 ||
        (r.absErr !== null && r.absErr > 3);
      if (bad(at100) || bad(at150)) {
        throw new Error(
          `Pointer coordinates off (100%: ${JSON.stringify(
            at100,
          )}; 150%: ${JSON.stringify(at150)})`,
        );
      }

      // Keyboard: Cmd+Shift+= steps by 10; plain Cmd+= is the canvas's.
      key("Equal", true);
      await waitPrefs("zoom 160 after Cmd+Shift+=", (p) => p.zoom === 160);
      const plain = key("Equal", false);
      await delay(win, 400);
      if (getPreferences(win).zoom !== 160) {
        throw new Error("Plain Cmd+= changed the interface zoom");
      }
      key("Minus", true);
      await waitPrefs("zoom 150 after Cmd+Shift+-", (p) => p.zoom === 150);
      key("Digit0", true);
      await waitPrefs("zoom 100 after Cmd+Shift+0", (p) => p.zoom === 100);
      const restored = await waitFor(
        "innerWidth restored at 100%",
        () =>
          Math.abs(win.innerWidth - base.innerWidth) <= 2
            ? win.innerWidth
            : null,
        6000,
      );
      await resetPhase2Config();
      return {
        baseInnerWidth: base.innerWidth,
        baseDpr: base.dpr,
        zoom150InnerWidth: zoomed.innerWidth,
        zoom150Dpr: zoomed.dpr,
        widthRatio: Number(widthRatio.toFixed(3)),
        restoredInnerWidth: restored,
        draw: {
          at100,
          at150,
          plainCmdEqualDefaultPrevented: plain.defaultPrevented,
        },
      };
    });

    await softStep("vault-settings-override", async () => {
      const handle = activeVault.handle;
      const probe = `smoke-suite-${runId}/sort-probe`;
      const names = ["a-probe", "b-probe", "c-probe"];
      const json = JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "smoke",
        elements: [],
        appState: {},
        files: {},
      });
      await call("create_folder", { handle, path: probe });
      for (const name of names) {
        await call("write_drawing", {
          handle,
          path: `${probe}/${name}.excalidraw`,
          json,
          expectedRevision: null,
          operationId: `probe-${name}-${runId}`,
        });
      }
      const row = (path: string) =>
        root.querySelector<HTMLElement>(
          `.vault-tree-item[data-tree-path="${win.CSS.escape(path)}"]`,
        );
      await runPaletteCommand("navigator: refresh files");
      const folderRow = await waitFor("sort probe folder row", () =>
        row(probe),
      );
      if (!row(`${probe}/a-probe.excalidraw`)) {
        folderRow.click();
      }
      await waitFor("probe rows", () => row(`${probe}/c-probe.excalidraw`));
      const order = () =>
        Array.from(
          root.querySelectorAll<HTMLElement>(
            `.vault-tree-item[data-tree-path^="${probe}/"]`,
          ),
        )
          .map((el) =>
            el.dataset.treePath?.split("/").pop()?.replace(".excalidraw", ""),
          )
          .join(",");
      const expectOrder = (label: string, want: string) =>
        waitFor(
          `${label}: ${want}`,
          () => (order() === want ? true : null),
          4000,
        ).catch(() => {
          throw new Error(`${label}: expected ${want}, got ${order()}`);
        });
      const globalSort = async () =>
        (
          (await call("load_settings")).config as Record<
            string,
            Record<string, unknown>
          > | null
        )?.navigator?.sort;
      const trail: Record<string, string> = {};
      try {
        await expectOrder("default", "a-probe,b-probe,c-probe");
        trail.default = order();

        await call("update_vault_settings", {
          handle,
          changes: [{ key: "navigator.sort", value: "name_desc" }],
        });
        await expectOrder("vault name_desc", "c-probe,b-probe,a-probe");
        trail.vaultNameDesc = order();
        if ((await globalSort()) !== undefined) {
          throw new Error("config.toml navigator.sort changed by a vault edit");
        }
        if (getPreferences(win).navigatorSort !== "name_asc") {
          throw new Error(
            "Global navigatorSort preference leaked the vault value",
          );
        }

        // Vault file edited back: applies live; wins over a global name_desc.
        await call("update_config", {
          changes: [{ key: "navigator.sort", value: "name_desc" }],
        });
        await call("update_vault_settings", {
          handle,
          changes: [{ key: "navigator.sort", value: "name_asc" }],
        });
        await expectOrder(
          "vault name_asc over global name_desc",
          "a-probe,b-probe,c-probe",
        );
        trail.vaultBeatsGlobal = order();

        // Removing the override falls back to the global value.
        await call("update_vault_settings", {
          handle,
          changes: [{ key: "navigator.sort", value: null }],
        });
        await expectOrder(
          "override removed, global name_desc",
          "c-probe,b-probe,a-probe",
        );
        trail.globalAfterRemoval = order();
        const vaultFile = await call("load_vault_settings", { handle });
        if (
          vaultFile.settingsError ||
          JSON.stringify(vaultFile.settings?.navigator ?? {}) !== "{}"
        ) {
          throw new Error(
            `vault settings not clean: ${JSON.stringify(vaultFile)}`,
          );
        }
      } finally {
        await call("update_vault_settings", {
          handle,
          changes: [{ key: "navigator.sort", value: null }],
        }).catch(() => {});
        await resetPhase2Config();
      }
      await expectOrder("restored", "a-probe,b-probe,c-probe");
      return trail;
    });

    await softStep("new-drawing-default-folder", async () => {
      const handle = activeVault.handle;
      const folder = "Smoke Inbox/Deep";
      await call("update_vault_settings", {
        handle,
        changes: [{ key: "files.new_drawing_folder", value: folder }],
      });
      try {
        await delay(win, 2000); // watcher debounce (~0.6 s) + vault-settings-change round trip
        // The header button is gone; Mod+N is the same command (no `code` + both
        // modifiers set = plain Mod on every OS, see chordFromEvent).
        doc.dispatchEvent(
          new win.KeyboardEvent("keydown", {
            key: "n",
            metaKey: true,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
        const created = await pollAsync(
          `new drawing in ${folder}`,
          async () => {
            const deep = await call("list_directory", {
              handle,
              path: folder,
            }).catch(() => [] as VaultEntry[]);
            return deep.find((e) => e.kind === "drawing")?.path ?? null;
          },
          8000,
        );
        const rootList = await call("list_directory", { handle, path: "" });
        const inbox = await call("list_directory", {
          handle,
          path: "Smoke Inbox",
        });
        if (
          !rootList.some(
            (e) => e.path === "Smoke Inbox" && e.kind === "folder",
          ) ||
          !inbox.some((e) => e.path === folder && e.kind === "folder")
        ) {
          throw new Error("Default folder chain was not created");
        }
        return { folder, created };
      } finally {
        await call("update_vault_settings", {
          handle,
          changes: [{ key: "files.new_drawing_folder", value: null }],
        }).catch(() => {});
      }
    });

    // ---- Templates (F9): real native commands, not run in CI ----
    // The reveal command opens a file manager window; spy on the real IPC
    // bridge to prove no template step ever calls it.
    const templateIpc: string[] = [];
    const internals = (
      win as unknown as {
        __TAURI_INTERNALS__?: {
          invoke: (cmd: string, ...r: unknown[]) => unknown;
        };
      }
    ).__TAURI_INTERNALS__;
    const originalInternalInvoke = internals?.invoke;
    // Newer Tauri builds freeze __TAURI_INTERNALS__.invoke; then the spy is
    // off and the step says so instead of aborting the whole run.
    let ipcSpy = false;
    if (internals && originalInternalInvoke) {
      try {
        internals.invoke = (cmd: string, ...rest: unknown[]) => {
          templateIpc.push(cmd);
          return originalInternalInvoke.call(internals, cmd, ...rest);
        };
        ipcSpy = internals.invoke !== originalInternalInvoke;
      } catch {
        ipcSpy = false;
      }
    }
    const templateScene = (marker: string) =>
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "desktop-smoke",
        elements: [
          {
            id: `tpl-rect-${marker}`,
            type: "rectangle",
            x: 10,
            y: 10,
            width: 120,
            height: 60,
            angle: 0,
            strokeColor: "#1e1e1e",
            backgroundColor: "#a5d8ff",
            fillStyle: "solid",
            strokeWidth: 2,
            strokeStyle: "solid",
            roughness: 1,
            opacity: 100,
            groupIds: [`tpl-group-${marker}`],
            frameId: null,
            roundness: null,
            seed: 7,
            version: 1,
            versionNonce: 7,
            isDeleted: false,
            boundElements: null,
            updated: 1,
            link: null,
            locked: false,
          },
        ],
        appState: { viewBackgroundColor: "#fff4e6" },
        files: {},
      });
    const templateDeps = () => ({
      repository: desktopRepository,
      handle: activeVault.handle,
      folder: "Templates",
      global: createGlobalTemplateStore({ invoke: invoke as InvokeFn }),
    });

    await softStep("templates-vault-create-list-instantiate", async () => {
      const marker = `${runId}-v`;
      const name = `Smoke Tpl ${marker}`;
      await call("create_folder", {
        handle: activeVault.handle,
        path: "Templates",
      }).catch(() => {}); // may exist from an earlier run
      await call("write_drawing", {
        handle: activeVault.handle,
        path: `Templates/${name}.excalidraw`,
        json: templateScene(marker),
        expectedRevision: null,
        operationId: `tpl-${marker}`,
      });
      const deps = templateDeps();
      const listed = await listTemplates(deps);
      const entry = listed.vault.find((t) => t.name === name);
      if (!entry) {
        throw new Error(
          `listTemplates missed ${name}: ${JSON.stringify(listed.vault)}`,
        );
      }
      const source = await readTemplateJson(entry, deps);
      const made = JSON.parse(instantiateTemplate(source, { theme: "light" }));
      const [el] = made.elements;
      if (
        made.elements.length !== 1 ||
        el.type !== "rectangle" ||
        el.id === `tpl-rect-${marker}` ||
        el.groupIds[0] === `tpl-group-${marker}` ||
        el.backgroundColor !== "#a5d8ff" ||
        made.appState.viewBackgroundColor !== "#fff4e6"
      ) {
        throw new Error(`Bad instantiation: ${JSON.stringify(made)}`);
      }
      return { listed: listed.vault.length, newId: el.id };
    });

    await softStep("templates-picker-creates-drawing", async () => {
      const marker = `${runId}-v`;
      const name = `Smoke Tpl ${marker}`;
      // With no default folder set, a new drawing (blank or from a template)
      // goes next to the active drawing, which an earlier step left in a
      // subfolder; look there, not only in the vault root.
      const activePath =
        root.querySelector<HTMLElement>(
          ".vault-tree-item--active .vault-tree-item__name",
        )?.title ?? "";
      const parent = activePath.includes("/")
        ? activePath.slice(0, activePath.lastIndexOf("/"))
        : "";
      doc.dispatchEvent(
        new win.KeyboardEvent("keydown", {
          key: "n",
          code: "KeyN",
          metaKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      const row = await waitFor("picker row", () =>
        Array.from(
          doc.querySelectorAll<HTMLElement>(".template-picker__row"),
        ).find((r) => r.textContent?.includes(name)),
      );
      const revealShown = !!doc.querySelector(".template-picker__state button");
      row.click();
      const created = await pollAsync(
        `drawing created from ${name} in "${parent}"`,
        async () => {
          const entries = await call("list_directory", {
            handle: activeVault.handle,
            path: parent,
          }).catch(() => [] as VaultEntry[]);
          return (
            entries.find(
              (e) => e.kind === "drawing" && e.name.startsWith(`${name}-`),
            )?.path ?? null
          );
        },
        8000,
      );
      const file = await call("read_drawing", {
        handle: activeVault.handle,
        path: created,
      });
      const scene = JSON.parse(file.json);
      if (
        scene.elements.length !== 1 ||
        scene.elements[0].id === `tpl-rect-${marker}` ||
        scene.appState?.viewBackgroundColor !== "#fff4e6"
      ) {
        throw new Error(`Created drawing is wrong: ${file.json.slice(0, 300)}`);
      }
      return { created, parent, revealShown };
    });

    await softStep("templates-global-write-list-read", async () => {
      const marker = `${runId}-g`;
      const file = `Smoke Global ${marker}.excalidraw`;
      const json = templateScene(marker);
      await invoke("write_global_template", { name: file, json });
      const listed = (await invoke("list_global_templates")) as Array<{
        name: string;
        size: number;
      }>;
      if (!listed.some((t) => t.name === file)) {
        throw new Error(`list_global_templates missed ${file}`);
      }
      const read = (await invoke("read_global_template", {
        name: file,
      })) as { json: string };
      if (read.json !== json) {
        throw new Error("read_global_template did not round-trip the JSON");
      }
      let collision = "";
      try {
        await invoke("write_global_template", { name: file, json });
      } catch (error) {
        collision = JSON.stringify(error);
      }
      if (!/NAME_COLLISION|exist/i.test(collision)) {
        throw new Error(`Overwrite was not refused: ${collision}`);
      }
      const viaStore = await listTemplates(templateDeps());
      if (!viaStore.global.some((t) => t.path === file)) {
        throw new Error("listTemplates did not include the global template");
      }
      if (templateIpc.includes("open_global_templates_dir")) {
        throw new Error("open_global_templates_dir was invoked");
      }
      return { listed: listed.length, ipc: templateIpc.length, ipcSpy };
    });
    if (internals && originalInternalInvoke && ipcSpy) {
      internals.invoke = originalInternalInvoke;
    }

    // ---- Colour themes (personal/planning/themes.md "Final decisions") ----
    type Rgba = [number, number, number, number];
    const hexToRgb = (hex: string): Rgba => {
      const h = hex.trim().replace(/^#/, "");
      const full =
        h.length === 3
          ? h
              .split("")
              .map((c) => c + c)
              .join("")
          : h.slice(0, 6);
      return [
        parseInt(full.slice(0, 2), 16),
        parseInt(full.slice(2, 4), 16),
        parseInt(full.slice(4, 6), 16),
        255,
      ];
    };
    const cssRgb = (value: string): Rgba | null => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) {
        return value.trim().startsWith("#") ? hexToRgb(value) : null;
      }
      const parts = m[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return [
        parts[0],
        parts[1],
        parts[2],
        parts.length > 3 ? parts[3] * 255 : 255,
      ];
    };
    const near = (a: Rgba | null, b: Rgba, tolerance = 2) =>
      !!a && [0, 1, 2].every((i) => Math.abs(a[i] - b[i]) <= tolerance);
    const rgbHex = (p: Rgba | null) =>
      p
        ? `#${p
            .slice(0, 3)
            .map((n) => Math.round(n).toString(16).padStart(2, "0"))
            .join("")}${p[3] < 255 ? `/a${Math.round(p[3])}` : ""}`
        : null;
    const rootVar = (name: string) =>
      doc.documentElement.style.getPropertyValue(name).trim().toLowerCase();
    const staticCanvasPixel = (): Rgba | null => {
      const canvas = root.querySelector<HTMLCanvasElement>(
        ".vault-editor canvas.static",
      );
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx || canvas.width < 20 || canvas.height < 20) {
        return null;
      }
      // Top-left corner of the scene: islands are DOM, the rectangle sits
      // around 35% of the viewport, so this area is empty canvas background.
      const d = ctx.getImageData(12, 12, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    };
    const waitForCanvasPixel = async (label: string, expected: string) => {
      const target = hexToRgb(expected);
      let last: Rgba | null = null;
      try {
        await waitFor(
          label,
          () => {
            last = staticCanvasPixel();
            return near(last, target) ? true : null;
          },
          5000,
        );
      } catch {
        throw new Error(
          `${label}: canvas pixel ${rgbHex(last)}, expected ${expected} ±2`,
        );
      }
      return rgbHex(last);
    };
    const openAppearanceSettings = async () => {
      if (!doc.querySelector(".vault-settings-modal")) {
        button("Settings").click();
      }
      const modal = await waitFor("settings modal", () =>
        doc.querySelector<HTMLElement>(".vault-settings-modal"),
      );
      (
        await waitFor("Appearance tab", () =>
          Array.from(modal.querySelectorAll<HTMLButtonElement>("button")).find(
            (item) => item.textContent?.trim() === "Appearance",
          ),
        )
      ).click();
      await waitFor("theme picker", () =>
        modal.querySelector('[data-testid="theme-picker"]'),
      );
      return modal;
    };
    const themeCard = (modal: HTMLElement, key: string) =>
      Array.from(
        modal.querySelectorAll<HTMLButtonElement>(".vault-theme-card"),
      ).find(
        (item) => item.dataset.themeKey?.toLowerCase() === key.toLowerCase(),
      ) ?? null;
    // The picker lists 120+ themes in a scrolling grid and renders a card's
    // preview only once it nears view, so reach a theme the way a user
    // would: type its name into the search field.
    const searchThemeCard = async (modal: HTMLElement, key: string) => {
      const input = await waitFor("theme search field", () =>
        modal.querySelector<HTMLInputElement>(".vault-theme-search__input"),
      );
      Object.getOwnPropertyDescriptor(
        win.HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, key);
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
      return waitFor(`${key} card after search`, () => {
        const cards = modal.querySelectorAll(".vault-theme-card");
        const card = themeCard(modal, key);
        // Wait for the deferred filter to apply and the preview to render.
        return card &&
          cards.length < 10 &&
          card.querySelector(".vault-theme-card__half")
          ? card
          : null;
      });
    };
    const closeSettings = async () => {
      const modal = doc.querySelector<HTMLElement>(".vault-settings-modal");
      if (!modal) {
        return;
      }
      modal
        .querySelector<HTMLButtonElement>('[aria-label="Close Settings"]')
        ?.click();
      await waitFor("settings modal closed", () =>
        doc.querySelector(".vault-settings-modal") ? null : true,
      );
    };
    const setSyncCanvas = async (on: boolean) => {
      const modal = await openAppearanceSettings();
      const input = await waitFor("sync canvas switch", () =>
        modal.querySelector<HTMLInputElement>("#vault-sync-canvas"),
      );
      if (input.checked !== on) {
        input.click();
      }
      await waitFor(
        `syncCanvas=${on}`,
        () =>
          getPreferences(win).syncCanvas === on &&
          doc.documentElement.dataset.vaultCanvasSync === (on ? "on" : "off")
            ? true
            : null,
        3000,
      );
      await closeSettings();
    };
    const waitForConfig = async (
      label: string,
      check: (config: typeof DEFAULT_CONFIG_JSON) => boolean,
    ) => {
      let loaded = await call("load_settings");
      const until = win.performance.now() + 3000;
      while (
        !(
          loaded.config && check(loaded.config as typeof DEFAULT_CONFIG_JSON)
        ) &&
        win.performance.now() < until
      ) {
        await delay(win, 100);
        loaded = await call("load_settings");
      }
      if (
        !loaded.config ||
        !check(loaded.config as typeof DEFAULT_CONFIG_JSON)
      ) {
        throw new Error(
          `${label}: config.toml has ${JSON.stringify(loaded.config)}`,
        );
      }
      return loaded.config as typeof DEFAULT_CONFIG_JSON;
    };
    // Theme steps are independent enough to keep going after one fails, so
    // a single regression does not hide the others; the run still fails.
    const themeStep = <T>(name: string, work: () => Promise<T>) =>
      step(name, work).catch(async () => {
        await closeSettings().catch(() => {});
      });
    const DRACULA_SURFACE = "#282a36";
    const DARK_CANVAS = "#121212";
    const TEST_PALETTE = {
      key: "Test Palette",
      mSurface: "#1b2b34",
      mOnSurface: "#d8dee9",
      mPrimary: "#ec5f67",
    };

    const exportCtx: ExportSmokeContext = {
      doc,
      win,
      root,
      waitFor,
      delay: (ms) => delay(win, ms),
      mark,
      call: (command, args) => invokeNative(command, args) as Promise<any>,
      vaultHandle: activeVault.handle,
      drawingPath: `${nested}/ui-edited.excalidraw`,
      staticCanvasPixel,
      hexToRgb,
      near,
      rgbHex,
      withSvgCsp: async (work) => {
        svgExportInFlight = true;
        try {
          return await work();
        } finally {
          // CSP reports arrive asynchronously, after the work resolves.
          await delay(win, 200);
          svgExportInFlight = false;
        }
      },
      themeColours: new Set<string>(),
      darkCanvas: DARK_CANVAS,
    };

    // The template and default-folder steps leave their own new drawing active;
    // the theme and export steps below work on (and assert against) ui-edited.
    await softStep("reopen-smoke-drawing", async () => {
      await openSmokeDrawing(exportCtx);
      await waitFor("static canvas", () => staticCanvasPixel());
      return { path: exportCtx.drawingPath };
    });

    await themeStep("theme-user-palette-loaded", async () => {
      const { getThemeRegistry, findTheme } = await import("../theme/registry");
      const registry = getThemeRegistry();
      if (registry.mode !== "tauri") {
        throw new Error(`Theme registry not in tauri mode: ${registry.mode}`);
      }
      if (registry.loadError) {
        throw new Error(`Theme registry loadError: ${registry.loadError}`);
      }
      if (registry.fileProblems.length) {
        throw new Error(
          `Theme file problems: ${JSON.stringify(registry.fileProblems)}`,
        );
      }
      const entry = findTheme(registry, TEST_PALETTE.key);
      if (!entry || entry.source !== "user") {
        throw new Error(
          `User theme "${TEST_PALETTE.key}" not in registry: ${JSON.stringify(
            registry.themes.map((t) => `${t.source}:${t.key}`),
          )}`,
        );
      }
      const { dark, light, generated } = entry.theme;
      if (
        dark.mSurface.toLowerCase() !== TEST_PALETTE.mSurface ||
        dark.mOnSurface.toLowerCase() !== TEST_PALETTE.mOnSurface ||
        dark.mPrimary.toLowerCase() !== TEST_PALETTE.mPrimary
      ) {
        throw new Error(
          `Dark variant does not keep the file's colours: ${JSON.stringify(
            dark,
          )}`,
        );
      }
      if (!generated.light || generated.dark) {
        throw new Error(
          `Expected only light to be generated: ${JSON.stringify(generated)}`,
        );
      }
      if (!light?.mSurface || light.mSurface.toLowerCase() === dark.mSurface) {
        throw new Error(
          `Generated light variant looks wrong: ${JSON.stringify(light)}`,
        );
      }
      const modal = await openAppearanceSettings();
      const card = await searchThemeCard(modal, TEST_PALETTE.key);
      const tag = card.querySelector(".vault-theme-card__tag")?.textContent;
      const autoBadge = card.querySelector(
        '.vault-theme-card__half[data-mode="light"] .vault-theme-card__auto',
      );
      const cardWarning = card.querySelector(
        ".vault-theme-card__warning",
      )?.textContent;
      const problemList = modal.querySelector(".vault-theme-problems");
      if (!autoBadge || tag !== "Custom" || cardWarning || problemList) {
        throw new Error(
          `Settings card: ${JSON.stringify({
            tag,
            autoBadge: !!autoBadge,
            cardWarning,
            problems: problemList?.textContent,
          })}`,
        );
      }
      await closeSettings();
      return {
        key: entry.key,
        path: entry.path,
        dark: {
          mSurface: dark.mSurface,
          mOnSurface: dark.mOnSurface,
          mPrimary: dark.mPrimary,
        },
        generatedLight: {
          mSurface: light.mSurface,
          mOnSurface: light.mOnSurface,
          mPrimary: light.mPrimary,
        },
        warnings: entry.warnings,
        settingsCard: { tag, autoBadge: true },
        themeCount: registry.themes.length,
      };
    });

    await themeStep("theme-switch-applies", async () => {
      const modal = await openAppearanceSettings();
      (await searchThemeCard(modal, "Dracula")).click();
      (
        await waitFor("Dark mode button", () =>
          Array.from(modal.querySelectorAll<HTMLButtonElement>("button")).find(
            (item) => item.textContent?.trim() === "Dark",
          ),
        )
      ).click();
      await waitFor(
        "--vault-bg = Dracula surface",
        () => (rootVar("--vault-bg") === DRACULA_SURFACE ? true : null),
        3000,
      ).catch(() => {
        throw new Error(
          `--vault-bg is "${rootVar(
            "--vault-bg",
          )}", expected ${DRACULA_SURFACE}`,
        );
      });
      const prefs = getPreferences(win);
      if (prefs.colorTheme !== "Dracula" || prefs.theme !== "dark") {
        throw new Error(
          `Preferences not updated: ${prefs.colorTheme}/${prefs.theme}`,
        );
      }
      if (!doc.documentElement.classList.contains("dark")) {
        throw new Error("html.dark missing in dark mode");
      }
      await closeSettings();
      const menuBg = rootVar("--vault-menu-bg");
      const excalidrawEl = root.querySelector<HTMLElement>(
        ".vault-editor .excalidraw",
      );
      const islandVar = excalidrawEl
        ? win
            .getComputedStyle(excalidrawEl)
            .getPropertyValue("--island-bg-color")
            .trim()
        : null;
      const overrideStyle = doc.getElementById(
        "vault-theme-excalidraw-vars",
      ) as HTMLStyleElement | null;
      // Themes use a constructed stylesheet (CSP-safe); <style> is a fallback.
      const overrideSheetApplied =
        !!overrideStyle?.sheet || doc.adoptedStyleSheets.length > 0;
      // Some islands are deliberately transparent wrappers; use painted ones.
      const islands = Array.from(
        root.querySelectorAll<HTMLElement>(".vault-editor .excalidraw .Island"),
      ).map((el) => ({
        el,
        bg: win.getComputedStyle(el).backgroundColor,
      }));
      const painted = islands.filter(({ bg }) => (cssRgb(bg)?.[3] ?? 0) > 0);
      const island = painted[0];
      const diagnostics = {
        menuBg,
        islandVar,
        overrideStyleInDom: !!overrideStyle,
        overrideSheetApplied,
        islands: islands.map(({ el, bg }) => `${el.className}: ${bg}`),
      };
      if (!island) {
        throw new Error(
          `No painted Excalidraw .Island: ${JSON.stringify(diagnostics)}`,
        );
      }
      const islandBg = island.bg;
      // Islands are --vault-surface (--island-bg-color); only popovers use
      // --vault-menu-bg (theme/excalidrawVars.ts, excalidrawChrome.css).
      const surfaceBg = rootVar("--vault-surface");
      if (!surfaceBg || !near(cssRgb(islandBg), hexToRgb(surfaceBg), 1)) {
        throw new Error(
          `Island background ${islandBg} != --vault-surface ${surfaceBg}: ${JSON.stringify(
            diagnostics,
          )}`,
        );
      }
      const config = await waitForConfig(
        "appearance.theme=Dracula written",
        (c) => c.appearance.theme === "Dracula" && c.appearance.mode === "dark",
      );
      return {
        vaultBg: rootVar("--vault-bg"),
        vaultMenuBg: menuBg,
        islandBackground: islandBg,
        islandClass: island.el.className,
        islandVar,
        overrideSheetApplied,
        configAppearance: config.appearance,
      };
    });

    await themeStep("theme-sync-canvas-pixels", async () => {
      // Make sure the drawing is open and its canvas is laid out.
      await waitFor("static canvas", () => staticCanvasPixel());
      const before = rgbHex(staticCanvasPixel());
      await setSyncCanvas(true);
      const syncedPixel = await waitForCanvasPixel(
        "sync on: canvas = Dracula surface",
        DRACULA_SURFACE,
      );
      await waitForConfig(
        "sync_canvas=true written",
        (c) => c.appearance.sync_canvas === true,
      );
      await setSyncCanvas(false);
      const standardPixel = await waitForCanvasPixel(
        "sync off: canvas = standard dark",
        DARK_CANVAS,
      );
      return {
        pixelAt: "static canvas (12,12) device px",
        beforeSync: before,
        syncOn: syncedPixel,
        syncOff: standardPixel,
        expected: { syncOn: DRACULA_SURFACE, syncOff: DARK_CANVAS },
      };
    });

    await themeStep("theme-export-keeps-standard-colours", async () => {
      const { getThemeRegistry, findTheme } = await import("../theme/registry");
      const dracula = findTheme(getThemeRegistry(), "Dracula");
      if (!dracula) {
        throw new Error("Dracula missing from registry");
      }
      const draculaColours = new Set(
        [
          dracula.theme.dark.mSurface,
          dracula.theme.dark.mOnSurface,
          dracula.theme.light.mSurface,
          dracula.theme.light.mOnSurface,
        ].map((c) => c.toLowerCase()),
      );
      const drawingPath = `${nested}/ui-edited.excalidraw`;

      // Real UI path: Main menu > Export image... > the dialog's PNG / SVG
      // button (VaultEditor renders under withStandardCanvasColors). The
      // bytes are captured and still written natively.
      const exportViaMenu = async (label: "PNG" | "SVG") => {
        const result = await exportViaDialog(exportCtx, label);
        return { ...result, nativeWritten: result.nativeWritten };
      };
      const pngCornerPixel = async (bytes: Uint8Array) => {
        const signature = Array.from(bytes.slice(0, 4));
        if (signature.join(",") !== "137,80,78,71") {
          throw new Error(`Export is not a PNG: ${signature}`);
        }
        const bitmap = await win.createImageBitmap(
          new win.Blob([bytes as BlobPart], { type: "image/png" }),
        );
        const scratch = doc.createElement("canvas");
        scratch.width = bitmap.width;
        scratch.height = bitmap.height;
        const sctx = scratch.getContext("2d")!;
        sctx.drawImage(bitmap, 0, 0);
        const d = sctx.getImageData(2, 2, 1, 1).data;
        return {
          pixel: [d[0], d[1], d[2], d[3]] as Rgba,
          size: `${bitmap.width}x${bitmap.height}`,
        };
      };
      const setMode = async (label: "Light" | "Dark") => {
        const modal = await openAppearanceSettings();
        (
          await waitFor(`${label} mode button`, () =>
            Array.from(
              modal.querySelectorAll<HTMLButtonElement>("button"),
            ).find((item) => item.textContent?.trim() === label),
          )
        ).click();
        await waitFor(
          `html.dark=${label === "Dark"}`,
          () =>
            doc.documentElement.classList.contains("dark") ===
            (label === "Dark")
              ? true
              : null,
          3000,
        );
        await closeSettings();
      };

      // A. Dark mode. Upstream Excalidraw exports in the editor theme
      //    (App.tsx keeps exportWithDarkMode = theme === dark), so the
      //    standard dark export background is #121212. Baseline with sync
      //    off, then with sync on: must be identical, never Dracula.
      await setSyncCanvas(false);
      await waitForCanvasPixel("sync off baseline", DARK_CANVAS);
      const baseline = await exportViaMenu("PNG");
      const baselinePng = await pngCornerPixel(baseline.bytes);
      await setSyncCanvas(true);
      await waitForCanvasPixel("sync on before export", DRACULA_SURFACE);
      const darkExport = await exportViaMenu("PNG");
      const darkPng = await pngCornerPixel(darkExport.bytes);
      if (
        !near(darkPng.pixel, baselinePng.pixel, 0) ||
        !near(darkPng.pixel, hexToRgb(DARK_CANVAS)) ||
        darkPng.pixel[3] !== 255
      ) {
        throw new Error(
          `Dark PNG with sync on ${rgbHex(
            darkPng.pixel,
          )}, sync-off baseline ${rgbHex(
            baselinePng.pixel,
          )}, expected standard ${DARK_CANVAS} (not ${DRACULA_SURFACE})`,
        );
      }
      const afterDarkExport = await waitForCanvasPixel(
        "sync restored after dark export",
        DRACULA_SURFACE,
      );

      // B. Light mode: canvas shows Dracula's light surface; PNG/SVG must
      //    carry the drawing's own #ffffff and #1e1e1e.
      await setMode("Light");
      const lightCanvas = await waitForCanvasPixel(
        "sync on light: canvas = Dracula light surface",
        dracula.theme.light.mSurface,
      );
      const lightExport = await exportViaMenu("PNG");
      const lightPng = await pngCornerPixel(lightExport.bytes);
      if (
        !near(lightPng.pixel, hexToRgb("#ffffff")) ||
        lightPng.pixel[3] !== 255
      ) {
        throw new Error(
          `Light PNG background ${rgbHex(
            lightPng.pixel,
          )}, expected the drawing's #ffffff (not ${
            dracula.theme.light.mSurface
          })`,
        );
      }
      const svgExport = await exportViaMenu("SVG");
      const svgText = new win.TextDecoder().decode(svgExport.bytes);
      const svgColours = Array.from(
        new Set(
          (svgText.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((c) =>
            c.toLowerCase(),
          ),
        ),
      );
      const svgThemed = svgColours.filter((c) => draculaColours.has(c));
      if (
        svgThemed.length ||
        !svgColours.includes("#ffffff") ||
        !svgColours.includes("#1e1e1e")
      ) {
        throw new Error(
          `SVG colours ${JSON.stringify(svgColours)} (themed: ${JSON.stringify(
            svgThemed,
          )}); expected #ffffff + #1e1e1e and no Dracula colours`,
        );
      }
      const afterLightExport = await waitForCanvasPixel(
        "sync restored after light export",
        dracula.theme.light.mSurface,
      );
      await setMode("Dark");
      await waitForCanvasPixel("back to dark Dracula canvas", DRACULA_SURFACE);
      const beforeEdit = await call("read_drawing", {
        handle: activeVault.handle,
        path: drawingPath,
      });
      const exported = {
        darkBaselineSyncOff: rgbHex(baselinePng.pixel),
        darkSyncOn: rgbHex(darkPng.pixel),
        canvasAfterDarkExport: afterDarkExport,
        lightCanvasSyncOn: lightCanvas,
        lightPngSyncOn: rgbHex(lightPng.pixel),
        canvasAfterLightExport: afterLightExport,
        pngSize: lightPng.size,
        svgColours,
        files: [baseline, darkExport, lightExport, svgExport].map(
          (e) => `${e.name} (${e.bytes.length} B, native=${e.nativeWritten})`,
        ),
      };

      // 2. Edit while sync is on (nudge everything 1px), then check the file
      //    on disk keeps standard colours.
      const key = (k: string, extra: KeyboardEventInit = {}) =>
        doc.dispatchEvent(
          new win.KeyboardEvent("keydown", {
            key: k,
            code: k,
            bubbles: true,
            cancelable: true,
            ...extra,
          }),
        );
      key("Escape");
      key("a", { metaKey: true, ctrlKey: true, code: "KeyA" });
      await delay(win, 150);
      key("ArrowRight");
      await delay(win, 150);
      key("Escape");
      let after = await call("read_drawing", {
        handle: activeVault.handle,
        path: drawingPath,
      });
      const until = win.performance.now() + 6000;
      while (
        after.revision === beforeEdit.revision &&
        win.performance.now() < until
      ) {
        await delay(win, 250);
        after = await call("read_drawing", {
          handle: activeVault.handle,
          path: drawingPath,
        });
      }
      const savedWhileSynced = after.revision !== beforeEdit.revision;
      const scene = JSON.parse(after.json) as {
        appState?: { viewBackgroundColor?: string };
        elements?: Array<{
          type: string;
          isDeleted?: boolean;
          strokeColor?: string;
          backgroundColor?: string;
        }>;
      };
      // Images (from the canvas-drop step) have a transparent stroke by design.
      const live = (scene.elements ?? []).filter(
        (e) => !e.isDeleted && e.type !== "image",
      );
      const strokes = Array.from(new Set(live.map((e) => e.strokeColor)));
      const fills = Array.from(new Set(live.map((e) => e.backgroundColor)));
      const viewBg = scene.appState?.viewBackgroundColor;
      if (viewBg !== "#ffffff") {
        throw new Error(
          `Saved viewBackgroundColor ${viewBg}, expected #ffffff`,
        );
      }
      if (strokes.some((s) => s !== "#1e1e1e")) {
        throw new Error(
          `Saved stroke colours ${JSON.stringify(strokes)}, expected #1e1e1e`,
        );
      }
      if (fills.some((f) => f !== "transparent")) {
        throw new Error(
          `Saved fill colours ${JSON.stringify(fills)}, expected transparent`,
        );
      }
      return {
        exports: exported,
        savedWhileSynced,
        savedRevision: after.revision,
        viewBackgroundColor: viewBg,
        strokeColors: strokes,
        fillColors: fills,
      };
    });

    // F27 / F16 steps. Run while the Dracula theme and canvas sync are on
    // (set up by the theme steps above), so they also prove exports and
    // clipboard copies never carry the theme's on-screen colours.
    {
      const { getThemeRegistry, findTheme } = await import("../theme/registry");
      const dracula = findTheme(getThemeRegistry(), "Dracula");
      for (const c of dracula
        ? [
            dracula.theme.dark.mSurface,
            dracula.theme.dark.mOnSurface,
            dracula.theme.light.mSurface,
            dracula.theme.light.mOnSurface,
          ]
        : []) {
        exportCtx.themeColours.add(c.toLowerCase());
      }
    }
    const exportStep = <T>(name: string, work: () => Promise<T>) =>
      step(name, work).catch(async () => {
        // Leave no dialog open for the next step.
        doc.querySelector<HTMLElement>(".Modal__background")?.click();
        await delay(win, 200);
      });
    await exportStep("export-dialog-options", () =>
      exportDialogOptionsStep(exportCtx),
    );
    await exportStep("clipboard-copy-png-svg", () =>
      clipboardCopyStep(exportCtx),
    );
    await exportStep("mermaid-offline", () => mermaidOfflineStep(exportCtx));
    await exportStep("explorer-export", () => explorerExportStep(exportCtx));
    await exportStep("perf-export-mermaid", () =>
      perfExportMermaidStep(exportCtx),
    );

    await themeStep("theme-user-palette-applies", async () => {
      const modal = await openAppearanceSettings();
      (await searchThemeCard(modal, TEST_PALETTE.key)).click();
      await waitFor(
        "--vault-bg = Test Palette mSurface",
        () => (rootVar("--vault-bg") === TEST_PALETTE.mSurface ? true : null),
        3000,
      ).catch(() => {
        throw new Error(
          `--vault-bg is "${rootVar("--vault-bg")}", expected ${
            TEST_PALETTE.mSurface
          }`,
        );
      });
      await closeSettings();
      const canvasPixel = await waitForCanvasPixel(
        "sync on: canvas = Test Palette surface",
        TEST_PALETTE.mSurface,
      );
      const config = await waitForConfig(
        "appearance.theme=Test Palette written",
        (c) => c.appearance.theme === TEST_PALETTE.key,
      );
      const banner = doc.querySelector(".vault-global-alert")?.textContent;
      if (banner && /theme/i.test(banner)) {
        throw new Error(`Theme problem banner shown: ${banner}`);
      }
      return {
        vaultBg: rootVar("--vault-bg"),
        vaultText: rootVar("--vault-text"),
        vaultPrimary: rootVar("--vault-primary"),
        canvasPixel,
        dataVaultTheme: doc.documentElement.dataset.vaultTheme,
        configTheme: config.appearance.theme,
      };
    });

    await step("theme-reset-defaults", async () => {
      await call("update_config", {
        changes: [
          { key: "appearance.theme", value: "Default" },
          { key: "appearance.mode", value: "system" },
          { key: "appearance.sync_canvas", value: false },
          { key: "saving.autosave_delay_ms", value: 500 },
        ],
      });
      await waitFor(
        "preferences back to defaults",
        () => {
          const p = getPreferences(win);
          return p.colorTheme === "Default" &&
            p.theme === "system" &&
            !p.syncCanvas &&
            p.autosaveDelayMs === 500
            ? true
            : null;
        },
        3000,
      );
      const loaded = await call("load_settings");
      const mismatches = diffConfig(DEFAULT_CONFIG_JSON, loaded.config);
      if (mismatches.length) {
        throw new Error(`Config not reset: ${mismatches.join("; ")}`);
      }
      await waitFor(
        "Default theme tokens removed",
        () => (rootVar("--vault-bg") === "" ? true : null),
        3000,
      ).catch(() => {
        throw new Error(
          `--vault-bg still "${rootVar("--vault-bg")}" after Default`,
        );
      });
      return {
        config: "defaults",
        canvasSync: doc.documentElement.dataset.vaultCanvasSync,
      };
    });

    // Notebook backgrounds (F20). Last: they write [paper] to config.toml
    // (reset afterwards) and change the open drawing.
    await exportStep("paper-default-stamped", () =>
      paperDefaultStampedStep(exportCtx),
    );
    await exportStep("paper-drawing-png-export", () =>
      paperDrawingPngExportStep(exportCtx),
    );

    // Page mode. The drawing steps leave it off; the default step writes
    // [page] to config.toml (reset afterwards), so it runs last.
    await exportStep("page-mode-switch", () => pageModeSwitchStep(exportCtx));
    await exportStep("page-pdf-export", () => pagePdfExportStep(exportCtx));
    await exportStep("page-default-stamped", () =>
      pageDefaultStampedStep(exportCtx),
    );

    // Last: reloads the page (never returns); the resumed run asserts the
    // reopened vault is writable (see reloadSmoke.ts). It runs even after soft
    // step failures (they travel in the marker and still fail the run); a hard
    // step failure aborts before this point and skips it.
    await requestReload({
      win,
      records,
      pageErrors,
      log: (record) => call("smoke_log", record),
    });

    const failed = records.filter((record) => !record.ok);
    if (failed.length) {
      throw new Error(
        `Failed steps: ${failed.map((record) => record.step).join(", ")}`,
      );
    }
    if (pageErrors.length) {
      throw new Error(`WebView reported errors: ${JSON.stringify(pageErrors)}`);
    }
    exitStatus = 0;
  } catch (error) {
    records.push({
      step: "harness-failure",
      ok: false,
      details: String(error),
    });
  } finally {
    restoreStorage();
    win.removeEventListener("error", onError);
    win.removeEventListener("unhandledrejection", onRejection);
    doc.removeEventListener("securitypolicyviolation", onCsp);
    const elapsedMs = Math.round(win.performance.now() - startedAt);
    const report = {
      elapsedMs,
      mountedAtMs,
      records,
      pageErrors,
      knownCspReports,
      vaultPath: vaultForReport?.path ?? null,
      limitations: [
        "Uses synthetic pointer input; this does not establish physical mouse, trackpad, accessibility, or automation parity.",
        "Folder/file IPC fixture provisioning is explicitly distinct from the UI-created drawing saved through the real editor.",
      ],
    };
    try {
      for (const record of records) {
        await call("smoke_log", {
          step: record.step,
          ok: record.ok,
          details: record.details,
        });
      }
      await call("smoke_finish", { status: exitStatus, details: report });
    } catch (finishError) {
      console.error(
        "Desktop smoke could not write/finish native report",
        finishError,
        report,
      );
    }
  }
}
