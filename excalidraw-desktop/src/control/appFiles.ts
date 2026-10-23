/**
 * Composes the ControlFiles the window methods need from a few raw app
 * pieces (repository, throwing cores, tab controls). Pure and testable.
 */
import { isNotFoundError } from "../vault/types";
import { probeExists } from "../tabs/missingWatcher";

import { renderExport, renderExportBlob } from "../export/renderExport";

import { ControlError } from "./errors";
import { waitForTabs } from "./tabActions";

import type { VaultInfo, VaultRepository } from "../vault/types";
import type { TabStore } from "../tabs/tabStore";
import type { OpenTarget } from "../tabs/types";
import type { ControlFiles } from "./windowMethods";

export interface AppFilesDeps {
  vault: VaultInfo | null;
  repository: Pick<
    VaultRepository,
    "readRevision" | "listDirectory" | "readDrawing"
  >;
  active: { path: string; dirty: boolean } | null;
  tabStore: TabStore | null;
  /** Tab strip actions (undefined when tabs are disabled). */
  activate?: (id: string) => void;
  close?: (id: string) => void;
  /** Opens a vault by absolute path and switches to it (no dialog). */
  openVaultAt: (path: string) => Promise<VaultInfo>;
  openDrawing: (
    path: string,
    opts?: { target?: OpenTarget },
  ) => Promise<boolean>;
  /** Throwing cores. */
  createEntry: (parent: string, name: string, json?: string) => Promise<void>;
  moveEntry: (
    from: string,
    to: string,
    rewriteLinks: boolean,
  ) => Promise<boolean>;
  trashEntry: (path: string) => Promise<void>;
  /** The window the export renders in. */
  win: (Window & typeof globalThis) | null;
  /**
   * Saves pending edits when `path` is the open drawing (exports read disk).
   * Only the live editor can hold unsaved edits: a tab switch saves the
   * outgoing drawing before the next one opens (tabController capture).
   */
  flushIfOpen: (path: string) => Promise<void>;
  /** Shows the busy overlay while `run` is in flight (mutating calls only). */
  busy: <T>(run: () => Promise<T>) => Promise<T>;
}

const summary = (v: VaultInfo) => ({
  name: v.name,
  path: v.path,
  readOnly: v.readOnly,
});

export function createAppFiles(d: AppFilesDeps): ControlFiles {
  const handle = () => d.vault?.handle ?? "";
  const missing = (e: unknown) =>
    isNotFoundError(e) ? false : Promise.reject(e);
  const exportWith = async <T>(
    path: string,
    render: (
      json: string,
      name: string,
      win: Window & typeof globalThis,
    ) => Promise<T>,
  ): Promise<T> => {
    if (!d.win) {
      throw new ControlError("UNAVAILABLE", "No window to render in");
    }
    await d.flushIfOpen(path);
    const { json } = await d.repository.readDrawing(handle(), path);
    return render(json, path.slice(path.lastIndexOf("/") + 1), d.win);
  };
  return {
    vault: () => (d.vault ? summary(d.vault) : null),
    active: () => d.active,
    tabState: () => d.tabStore?.getState() ?? null,
    activateTab: async (id) => {
      d.activate?.(id);
      if (d.tabStore) {
        await waitForTabs(d.tabStore, (s) => s.activeId === id);
      }
    },
    closeTab: async (id) => {
      d.close?.(id);
      if (d.tabStore) {
        await waitForTabs(d.tabStore, (s) => !s.tabs.some((t) => t.id === id));
      }
    },
    openVault: async (path) => summary(await d.openVaultAt(path)),
    openDrawing: (path, newTab) =>
      d.openDrawing(path, newTab ? { target: "new" } : undefined),
    drawingExists: (path) =>
      probeExists(d.repository, handle(), path).catch(missing),
    folderExists: (path) =>
      d.repository.listDirectory(handle(), path).then(() => true, missing),
    createDrawing: (parent, name, json) =>
      d.busy(() => d.createEntry(parent, name, json)),
    moveEntry: (from, to, rewriteLinks) =>
      d.busy(() => d.moveEntry(from, to, rewriteLinks)),
    trashEntry: (path) => d.busy(() => d.trashEntry(path)),
    // No busy overlay: an export only reads and renders off-screen, so the
    // user keeps editing while a script exports (and calls may overlap).
    exportDrawing: (path, format, options) =>
      exportWith(path, (json, name, win) =>
        renderExport(json, name, format, options, win),
      ),
    exportDrawingBlob: (path, format, options) =>
      exportWith(path, (json, name, win) =>
        renderExportBlob(json, name, format, options, win),
      ),
  };
}
