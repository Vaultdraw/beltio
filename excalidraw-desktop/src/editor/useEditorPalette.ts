import { useEffect, useRef } from "react";

import {
  CaptureUpdateAction,
  loadLibraryFromBlob,
} from "@excalidraw/excalidraw";
import { DEFAULT_SIDEBAR } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { selectPaperStyle } from "../components/paper/selectPaperStyle";
import { PAPER_STYLES } from "../components/paper/paperStyles";
import { paperCommandId } from "../commands/editorCommands";
import { registerCommandHandlers } from "../commands/handlerRegistry";
import { detectPlatform } from "../commands/keys";
import { registerPaletteProvider } from "../palette/registry";
import { createEditorProvider } from "../palette/providers/editor";
import { createPensProvider } from "../palette/providers/pens";
import {
  createLibraryItemsProvider,
  createLibraryManageProvider,
} from "../palette/providers/library";
import { getPreferences } from "../vault/preferences";

import type { CommandHandlers } from "../commands/types";
import type { PenPreset } from "../pens/penPresets";
import type { LibraryStore } from "../library/libraryStore";

import type { RefObject } from "react";

/** Window event the library panel listens to (see LibrarySectionControls). */
const LIBRARY_UI_EVENT = "vaultdraw:library-ui";
type LibraryUIRequest =
  | { action: "new" }
  | { action: "rename" | "remove"; sectionId: string };

type Options = {
  apiRef: RefObject<ExcalidrawImperativeAPI | null>;
  disabled: boolean;
  presets: readonly PenPreset[];
  activePen: number | null;
  selectPen: (index: number) => void;
  openPaperSettings: () => void;
  /** The persisted library; null = Excalidraw's in-memory one (not listed). */
  libraryStore: LibraryStore | null;
};

/**
 * While the editor is mounted: its palette providers (editor commands, pens)
 * and the handlers of the editor-owned commands (paper, library). Everything
 * reads refs at call time, so nothing runs while the palette is closed.
 */
export function useEditorPalette(options: Options): void {
  const live = useRef(options);
  live.current = options;
  const hasLibrary = options.libraryStore !== null;

  useEffect(() => {
    const platform = detectPlatform();
    const api = () => live.current.apiRef.current;

    const paper: CommandHandlers = Object.fromEntries(
      PAPER_STYLES.map((style) => [
        paperCommandId(style.id),
        () => {
          const current = api();
          if (
            !current ||
            live.current.disabled ||
            current.getAppState().viewModeEnabled
          ) {
            return;
          }
          const type = style.id === "plain" ? null : style.id;
          current.updateScene({
            appState: {
              viewBackgroundPattern: selectPaperStyle(
                type,
                current.getAppState().viewBackgroundPattern ?? null,
              ),
            },
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          });
        },
      ]),
    );
    const unbind = registerCommandHandlers({
      ...paper,
      "paper.settings": () => live.current.openPaperSettings(),
      // Only with a persisted library: off (`extensions.library`) = not
      // offered. Bound in this one layer so editor open notifies once.
      ...(hasLibrary
        ? {
            "library.toggle": () => {
              // The sidebar opens on its library tab, so a tab-less toggle
              // would never match the open state and could not close it: force.
              const current = live.current.apiRef.current;
              current?.toggleSidebar({
                ...DEFAULT_SIDEBAR,
                force: !current.getAppState().openSidebar,
              });
            },
          }
        : {}),
    });
    const unEditor = registerPaletteProvider(
      createEditorProvider(api, {
        platform,
        disabled: () => live.current.disabled,
        overrides: () => getPreferences().hotkeys,
      }),
    );
    const unPens = registerPaletteProvider(
      createPensProvider({
        platform,
        presets: () => live.current.presets,
        overrides: () => getPreferences().hotkeys,
        active: () => live.current.activePen,
        select: (i) => live.current.selectPen(i),
      }),
    );
    const unLibrary = registerPaletteProvider(
      createLibraryItemsProvider(() => {
        const store = live.current.libraryStore;
        const current = api();
        if (
          !store ||
          !current ||
          live.current.disabled ||
          current.getAppState().viewModeEnabled
        ) {
          return null;
        }
        return {
          // Unnamed items (from before names were required) can't be found
          // by name, so they are not listed.
          list: () =>
            store
              .listItems()
              .flatMap(({ id, name, scope, library }) =>
                name
                  ? [{ id, name, keywords: ["library", scope, library] }]
                  : [],
              ),
          insert: (id) => {
            const item = store.getItem(id);
            if (item) {
              current.insertLibraryItems([item]);
            }
          },
        };
      }),
    );
    const unLibraryManage = registerPaletteProvider(
      createLibraryManageProvider(() => {
        const store = live.current.libraryStore;
        const current = api();
        if (!store || !current || live.current.disabled) {
          return null;
        }
        const show = (request: LibraryUIRequest) => {
          // open the panel (once), then tell it what to do
          const open =
            current.getAppState().openSidebar?.name === DEFAULT_SIDEBAR.name;
          if (!open) {
            current.toggleSidebar({ ...DEFAULT_SIDEBAR, force: true });
          }
          setTimeout(
            () =>
              window.dispatchEvent(
                new CustomEvent(LIBRARY_UI_EVENT, { detail: request }),
              ),
            open ? 0 : 150,
          );
        };
        return {
          sections: () =>
            store.getSections().map((s) => ({
              id: s.id,
              label: s.label,
              named: s.name !== null,
            })),
          newLibrary: () => show({ action: "new" }),
          rename: (sectionId) => show({ action: "rename", sectionId }),
          remove: (sectionId) => show({ action: "remove", sectionId }),
          importInto: async (sectionId) => {
            const picked = await store.pickLibraryFile();
            if (!picked) {
              return;
            }
            await store.loadNow();
            const items = await loadLibraryFromBlob(
              new Blob([picked.json], { type: "application/json" }),
            );
            store.assign(
              items.filter((i) => !store.getItem(i.id)).map((i) => i.id),
              sectionId,
            );
            await current.updateLibrary({
              libraryItems: [...items],
              merge: true,
              prompt: false,
              openLibraryMenu: false,
            });
          },
        };
      }),
    );
    return () => {
      unbind();
      unEditor();
      unPens();
      unLibrary();
      unLibraryManage();
    };
  }, [hasLibrary]);
}
