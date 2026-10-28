import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import {
  serializeLibraryAsJSON,
  useHandleLibrary,
} from "@excalidraw/excalidraw";
import { DEFAULT_SIDEBAR, LIBRARY_SIDEBAR_TAB } from "@excalidraw/common";

import type {
  AppState,
  ExcalidrawImperativeAPI,
  LibraryUIOptions,
} from "@excalidraw/excalidraw/types";

import { toastStore } from "../toasts/toastStore";

import { libraryPanelStore } from "./libraryPanelState";

import "./library.css";

import { LibraryStore } from "./libraryStore";

import type { LibraryRepository } from "./types";

const encoder = new TextEncoder();

/**
 * Connects the editor to the app-wide LibraryStore: persistence adapter,
 * external-change pushes, sidebar-open trigger, UI options and error toasts.
 */
/** Used when the editor has no persisted library (tests, previews). */
const INERT_REPOSITORY: LibraryRepository = {
  readLibrary: async () => ({
    json: null,
    revision: null,
    unchanged: false,
    path: "",
    readOnly: true,
  }),
  writeLibrary: async () => ({ revision: "" }),
  pickLibraryFile: async () => null,
  exportFile: async () => false,
  subscribe: async () => () => {},
};
const INERT_STORE = new LibraryStore(INERT_REPOSITORY);

export const useVaultLibrary = (
  library: { store: LibraryStore; repository: LibraryRepository } | undefined,
  editorApi: ExcalidrawImperativeAPI | null,
) => {
  const store = library?.store ?? INERT_STORE;
  const repository = library?.repository ?? INERT_REPOSITORY;
  const api = library ? editorApi : null;
  useHandleLibrary({ excalidrawAPI: api, adapter: store.adapter });

  const version = useSyncExternalStore(
    useCallback((cb) => store.subscribe(() => cb()), [store]),
    () => store.getVersion(),
  );

  // Push merges of external edits (and vault switches) into the editor.
  useEffect(() => {
    if (!api) {
      return;
    }
    return store.subscribe((kind) => {
      if (kind === "external") {
        void api.updateLibrary({
          libraryItems: store.union(),
          merge: false,
          skipRestore: true, // the store only holds restored items
        });
      }
    });
  }, [api, store]);

  // Libraries in extra folders are not watched: look again when the window
  // regains focus (cheap: one revision check per file, nothing while closed).
  useEffect(() => {
    if (!api) {
      return;
    }
    const onFocus = () => void store.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [api, store]);

  // Toast each distinct problem once.
  const toasted = useRef(new Set<string>());
  useEffect(() => {
    for (const message of store.getErrors()) {
      if (api && !toasted.current.has(message)) {
        toasted.current.add(message);
        toastStore.push({ message, kind: "error", durationMs: 10000 });
      }
    }
  }, [api, store, version]);

  // The editor going away closes its sidebar.
  useEffect(() => () => libraryPanelStore.publish(false), []);

  const onAppState = useCallback(
    (appState: Pick<AppState, "openSidebar">) => {
      const sidebar = appState.openSidebar;
      const showing =
        sidebar?.name === DEFAULT_SIDEBAR.name &&
        (sidebar.tab ?? LIBRARY_SIDEBAR_TAB) === LIBRARY_SIDEBAR_TAB;
      libraryPanelStore.publish(showing);
      if (!store.isStarted() && showing) {
        void store.loadNow();
      }
    },
    [store],
  );

  const libraryUIOptions = useMemo<LibraryUIOptions>(() => {
    const info = store.getSections();
    const list = info.map((section) => ({
      id: section.id,
      label: section.label,
      canAdd: !section.readOnly,
      manageable: section.name !== null,
      emptyHint:
        section.id === "personal"
          ? "Items you add here are available in every vault."
          : section.id === "vault"
          ? "Saved in library.excalidrawlib in this vault, so it travels with the vault."
          : section.scope === "vault"
          ? "Saved in this vault's .excalidraw-vault/libraries folder."
          : "Saved as a .excalidrawlib file you can open in Excalidraw.",
    }));
    const targets = [
      { id: "personal", label: "Personal" },
      ...(store.hasVault() && !store.isVaultReadOnly()
        ? [{ id: "vault", label: "This vault" }]
        : []),
    ];
    return {
      online: false,
      namedItems: true,
      sections: {
        list,
        sectionOf: store.sectionOf,
        assign: (ids, section) => store.assign(ids, section),
        manage: {
          targets,
          create: (name, target) =>
            store.createLibrary(
              target === "vault" ? "vault" : "personal",
              name,
            ),
          rename: (id, name) => store.renameLibrary(id, name),
          remove: (id) => store.removeLibrary(id),
        },
      },
      pickLibraryFile: async () => {
        const picked = await repository.pickLibraryFile();
        return picked
          ? new Blob([picked.json], { type: "application/json" })
          : null;
      },
      saveLibraryFile: async (items, suggestedName) => {
        const name =
          suggestedName.replace(/\.excalidrawlib$/i, "") || "library";
        await repository.exportFile(
          `${name}.excalidrawlib`,
          encoder.encode(serializeLibraryAsJSON(items)),
        );
      },
    };
    // version: sections, sectionOf results and read-only state changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, repository, version]);

  return {
    libraryUIOptions: library ? libraryUIOptions : undefined,
    onAppState,
  };
};
