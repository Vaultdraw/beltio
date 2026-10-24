/**
 * The import runner: what happens after a file with a plugin importer is
 * dropped or picked. One import at a time. Files over 32 MiB are refused
 * before the plugin loads; the plugin loads on the first import; `{ ops }`
 * from the importer are applied as one undo step if the drawing is still the
 * target. The signal aborts on a drawing switch, a plugin stop and
 * "Import: Cancel".
 */
import { appEvents } from "../../events/appEvents";
import { applyOps, dataKeyFor, SceneOpsError } from "../../sceneOps";
import { getPreferences } from "../../vault/preferences";
import { getActiveScene } from "../../sceneOps/sceneBus";
import { toastStore } from "../../toasts/toastStore";
import { type ImportItem, type ImportTarget } from "../importerMap";
import { setImportCanceller, setImportRunner } from "../importerMapAdmin";

import {
  baseName,
  importBusyMessage,
  importCancelledMessage,
  importChangedMessage,
  importFailedMessage,
  importMissingMessage,
  importReadOnlyMessage,
  importTooBigMessage,
  makeImportInput,
  MAX_IMPORT_BYTES,
  resultOps,
} from "../../../../sdk/api/testing/importers";

import { ensureActive, getRuntime } from "./activation";
import { errorText, logLine, reportPluginError } from "./errors";
import { guard } from "./guard";
import {
  beginImport,
  currentImport,
  endImport,
  getImporter,
} from "./importerRegistry";

const toast = (message: string, kind?: "error") =>
  toastStore.push(kind ? { message, kind } : { message });

/** Stops the rest of the items after a switch or a cancel. */
let halted: "switch" | "cancel" | null = null;
let running = false;

async function runOne(item: ImportItem, target: ImportTarget): Promise<void> {
  const { file, match } = item;
  const { pluginId, importerId } = match;
  const fileName = baseName(file.name);
  if (file.size > MAX_IMPORT_BYTES) {
    toast(importTooBigMessage(fileName));
    return;
  }
  // Set up before loading the plugin, so Cancel and a drawing switch during
  // activation are seen too.
  const controller = new AbortController();
  beginImport(pluginId, controller);
  const off = appEvents.on("drawing.opened", () => {
    halted = "switch";
    controller.abort("switch");
  });
  const changed = (name: string) => {
    logLine(pluginId, "warn", "DRAWING_CHANGED: nothing was applied");
    toast(importChangedMessage(name), "error");
  };
  try {
    const loaded = await ensureActive(pluginId);
    const rt = getRuntime(pluginId);
    if (controller.signal.aborted) {
      if (controller.signal.reason === "cancel") {
        toast(importCancelledMessage(rt?.info.name ?? pluginId));
      }
      return;
    }
    if (!loaded || !rt) {
      toast(
        `${
          rt?.info.name ?? pluginId
        } could not be loaded, so ${fileName} was not imported (see Settings, Plugins)`,
        "error",
      );
      return;
    }
    const name = rt.info.name;
    const importer = getImporter(rt, importerId);
    if (!importer) {
      const message = importMissingMessage(name, importerId);
      reportPluginError(pluginId, new Error(message), "importer");
      toast(message, "error");
      return;
    }
    const input = makeImportInput(
      fileName,
      file.size,
      async () => new Uint8Array(await file.arrayBuffer()),
    );
    const run = guard(
      pluginId,
      async () => {
        try {
          return await importer.import(input, {
            signal: controller.signal,
            at: target.at,
            path: target.path,
          });
        } catch (err) {
          if (controller.signal.aborted) {
            return undefined; // stopping on abort is the expected reaction
          }
          toast(importFailedMessage(name, fileName, errorText(err)), "error");
          throw err;
        }
      },
      `importer ${importerId}`,
      true,
    );
    const ops = resultOps(await run());
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      if (reason === "cancel") {
        toast(importCancelledMessage(name));
      } else if (reason === "switch" && ops) {
        changed(name);
      }
      return;
    }
    if (!ops) {
      return;
    }
    const scene = getActiveScene();
    if (!scene || scene.path !== target.path) {
      halted = "switch";
      changed(name);
      return;
    }
    if (scene.readOnly) {
      toast(importReadOnlyMessage);
      return;
    }
    try {
      // The same path as ctx.scene.batch: one applyOps call is one undo step.
      applyOps(scene.api, ops, {
        dataKey: dataKeyFor(pluginId, rt.info.dataKey),
        maxOps: getPreferences().pluginsSceneMaxOps,
      });
    } catch (err) {
      if (err instanceof SceneOpsError) {
        reportPluginError(pluginId, err, `importer ${importerId}`);
      } else {
        logLine(pluginId, "error", errorText(err));
      }
      toast(importFailedMessage(name, fileName, errorText(err)), "error");
    }
  } finally {
    off();
    endImport(controller);
  }
}

/** Runs the items one after another into `target`. */
export async function runImportItems(
  items: readonly ImportItem[],
  target: ImportTarget,
): Promise<void> {
  if (running) {
    toast(importBusyMessage);
    return;
  }
  running = true;
  halted = null;
  try {
    for (const item of items) {
      if (halted) {
        break;
      }
      await runOne(item, target);
    }
  } finally {
    running = false;
    halted = null;
  }
}

/** "Import: Cancel": aborts the running import; true when one was running. */
export function cancelRunningImport(): boolean {
  if (!running) {
    return false;
  }
  // Also stops the files not started yet, even between two of them.
  halted = "cancel";
  currentImport()?.controller.abort("cancel");
  return true;
}

/** The host sets the runner and the canceller on start and clears them on stop. */
export function installImportRunner(): () => void {
  setImportRunner(runImportItems);
  setImportCanceller(cancelRunningImport);
  return () => {
    setImportRunner(null);
    setImportCanceller(null);
  };
}
