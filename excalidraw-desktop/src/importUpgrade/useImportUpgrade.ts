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
import { openReport } from "../commands/configCommands";
import { toastStore } from "../toasts/toastStore";
import { getImportDrawingLook } from "../vault/newDrawingPaper";
import { getPreferences } from "../vault/preferences";

import {
  hasOldLook,
  IMPORT_MARK,
  importFontFamily,
  webPictureBoxes,
} from "./upgradeScene";
import { UPDATE_IMPORTED_NOTES, UPDATE_THIS_NOTE } from "./commands";

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

/** The list of skipped notes: one per line, the note's path without the extension, then why. */
export const skippedText = (list: { path: string; reason: string }[]) =>
  [
    ...list.map(
      (f) => `${f.path.replace(/\.excalidraw$/, "")}\n    ${f.reason}`,
    ),
    "",
    'To update one anyway: right-click it in the file list and choose "Update to my theme and font anyway", or open it and run that command from the palette. History keeps the note as it was before.',
  ].join("\n");

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
    const run = async (one = false) => {
      // Chosen on a folder's menu: that folder only; from the palette or a key: the whole vault.
      // "Anyway": the file whose menu was used, or the open drawing.
      const target = takeMenuTarget(
        one ? UPDATE_THIS_NOTE : UPDATE_IMPORTED_NOTES,
      );
      const folder =
        !one && target?.kind === "folder" && target.path
          ? target.path
          : undefined;
      const file = one
        ? (target?.kind === "drawing" && target.path) ||
          live.current.activeDoc?.path
        : undefined;
      if (one && !file) {
        return;
      }
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
          anyway: file ? [file] : undefined,
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
        const list = summary.skippedFiles;
        toastStore.push({
          key: KEY,
          message: file
            ? summary.updated === 1
              ? "Updated this note to your theme and font"
              : list.length > 0
              ? "Could not update this note"
              : "This note already has your theme and font"
            : summary.updated === 0
            ? "No imported note needed updating"
            : `Updated ${plural(
                summary.updated,
                "imported note",
                "imported notes",
              )} to your theme and font`,
          detail: file
            ? list[0]?.reason ??
              (summary.updated === 1
                ? "History keeps the note as it was before"
                : undefined)
            : list.length > 0
            ? `${plural(list.length, "note was", "notes were")} left as ${
                list.length === 1 ? "it was" : "they were"
              }`
            : summary.updated > 0
            ? "History keeps each note as it was before"
            : undefined,
          ...(!file && list.length > 0
            ? {
                durationMs: 0,
                actions: [
                  {
                    label: "View list",
                    run: () =>
                      openReport({
                        title: "Imported notes left as they were",
                        text: skippedText(list),
                        tone: "warning",
                      }),
                  },
                ],
              }
            : {}),
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
      [UPDATE_IMPORTED_NOTES]: () => run(),
      [UPDATE_THIS_NOTE]: () => run(true),
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
      {
        pluginId: "app",
        pluginName: "Vaultdraw",
        surface: "tree",
        title: "Update to my theme and font anyway",
        command: UPDATE_THIS_NOTE,
        kinds: ["drawing"],
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
    // Cheap tests first: only an import, or a drawing with a linked web address, is parsed. The
    // oldest imports of plain notes carry no mark but may hold picture boxes (#108).
    if (
      !json.includes(IMPORT_MARK) &&
      !/"link":\s*"(?:https?|data):/i.test(json)
    ) {
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
