/**
 * The app side of "Update imported notes" (toimprove #102): the palette command, the same
 * action on a folder's menu (that folder only), and one notice the first time the user opens an
 * imported note that still has the old look or undownloaded web pictures. Nothing runs at
 * startup: the check reads the JSON the open drawing already loaded, and only when it carries the
 * import's mark. The pass itself is a lazy chunk.
 */
import { useEffect, useRef } from "react";

import {
  getRegisteredHandler,
  registerCommandHandlers,
} from "../commands/handlerRegistry";
import {
  addMenuItems,
  runCommand,
  takeMenuTarget,
} from "../plugins/menuRegistry";
import { toastStore } from "../toasts/toastStore";
import { getImportDrawingLook } from "../vault/newDrawingPaper";
import { getPreferences } from "../vault/preferences";

import {
  hasOldLook,
  IMPORT_MARK,
  importFontFamily,
  webPictureBoxes,
} from "./upgradeScene";
import { UPDATE_IMPORTED_NOTES } from "./commands";

import type { UpgradeTarget } from "./upgradeScene";
import type { HistoryRepository } from "../history/types";
import type { VaultDocument } from "../vault/useVaultDocument";
import type { VaultInfo, VaultRepository } from "../vault/types";

const KEY = "import-upgrade";
const PLUGIN = "markdown-import";
/** The import plugin's own command that turns web-picture boxes into pictures (asks consent). */
const DOWNLOAD_PICTURES = "markdown-import.download-images";

const importSettings = (win: Window | null) =>
  getPreferences(win).pluginSettings[PLUGIN] ?? {};

export const upgradeTarget = (win: Window | null): UpgradeTarget => ({
  look: getImportDrawingLook(win),
  fontFamily: importFontFamily(
    importSettings(win).font,
    getPreferences(win).defaultFontFamily,
  ),
});

interface Options {
  win: Window | null;
  vault: VaultInfo | null;
  repository: VaultRepository;
  history: HistoryRepository;
  activeDoc: VaultDocument | null;
  /** Saves pending edits of the open drawing before the pass reads it. */
  flush: () => Promise<void>;
  /** Reads the open drawing again after the pass rewrote it. */
  reload: () => Promise<void>;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

export function useImportUpgrade(o: Options): void {
  const live = useRef(o);
  live.current = o;
  const running = useRef(false);
  const offered = useRef(false);
  const writable = !!o.vault && !o.vault.readOnly;

  useEffect(() => {
    if (!writable) {
      return;
    }
    const run = async () => {
      // Chosen on a folder's menu: that folder only; from the palette or a key: the whole vault.
      const target = takeMenuTarget(UPDATE_IMPORTED_NOTES);
      const folder =
        target?.kind === "folder" && target.path ? target.path : undefined;
      const { vault, repository, history, win, flush } = live.current;
      if (!vault || running.current) {
        return;
      }
      running.current = true;
      try {
        await flush().catch(() => undefined);
        const { runImportUpgrade } = await import("./runUpgrade");
        const summary = await runImportUpgrade({
          repository,
          history,
          handle: vault.handle,
          target: upgradeTarget(win),
          folder,
          onProgress: (done, total) =>
            toastStore.push({
              key: KEY,
              message: "Updating imported notes",
              progress: { done, total },
            }),
        });
        const open = live.current.activeDoc?.path;
        if (open && summary.paths.includes(open)) {
          await live.current.reload().catch(() => undefined);
        }
        toastStore.push({
          key: KEY,
          message:
            summary.updated === 0
              ? "No imported note needed updating"
              : `Updated ${plural(
                  summary.updated,
                  "imported note",
                  "imported notes",
                )} to your theme and font`,
          detail:
            summary.skipped > 0
              ? `${summary.skipped} left as they were (changed meanwhile, or no history version could be saved)`
              : summary.updated > 0
              ? "History keeps each note as it was before"
              : undefined,
        });
      } catch (err) {
        toastStore.push({
          key: KEY,
          kind: "error",
          message: "Could not update the imported notes",
          detail: err instanceof Error ? err.message : String(err),
        });
      } finally {
        running.current = false;
      }
    };
    const offHandlers = registerCommandHandlers({
      [UPDATE_IMPORTED_NOTES]: run,
    });
    const offMenu = addMenuItems([
      {
        pluginId: "app",
        pluginName: "Vaultdraw",
        surface: "tree",
        title: "Update imported notes here",
        command: UPDATE_IMPORTED_NOTES,
        kinds: ["folder"],
      },
    ]);
    return () => {
      offMenu();
      offHandlers();
    };
  }, [writable]);

  const docId = o.activeDoc?.id;
  useEffect(() => {
    const doc = live.current.activeDoc;
    const { win } = live.current;
    if (!writable || offered.current || !doc) {
      return;
    }
    const { json } = doc.source;
    if (!json.includes(IMPORT_MARK)) {
      return;
    }
    if (importSettings(win).offer_update === false) {
      return;
    }
    let scene;
    try {
      scene = JSON.parse(json);
    } catch {
      return;
    }
    const old = hasOldLook(scene, upgradeTarget(win));
    const pictures = webPictureBoxes(scene);
    if (!old && pictures === 0) {
      return;
    }
    offered.current = true;
    const actions = [
      ...(old
        ? [
            {
              label: "Update",
              // Through the handler registry, like the palette.
              run: () => void getRegisteredHandler(UPDATE_IMPORTED_NOTES)?.(),
            },
          ]
        : []),
      ...(pictures > 0
        ? [
            {
              label: "Download pictures",
              run: () => {
                try {
                  runCommand(DOWNLOAD_PICTURES);
                } catch {
                  // The import plugin is off: nothing can download.
                }
              },
            },
          ]
        : []),
    ];
    toastStore.push({
      key: `${KEY}-offer`,
      message: old
        ? "This note was imported with the old look"
        : `This note has ${plural(
            pictures,
            "web picture",
            "web pictures",
          )} that were not downloaded`,
      detail: old
        ? "Your theme and font for every imported note"
        : "Downloading asks once before contacting the sites",
      durationMs: 0,
      actions,
    });
  }, [docId, writable]);
}
