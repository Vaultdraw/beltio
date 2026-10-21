/**
 * Window-side control methods for vault, files and tabs (C3). Pure: every
 * app effect is injected through ControlFiles; VaultApp supplies the same
 * throwing cores the UI handlers use.
 */
import { ControlError } from "./errors";
import {
  moveDestination,
  objectParams,
  relPath,
  splitPath,
  stringParam,
  withExt,
} from "./params";
import { resolveTabId, tabListResult } from "./tabList";

import type { TabsState } from "../tabs/types";

export interface VaultSummary {
  name: string;
  path: string;
  readOnly: boolean;
}

export interface ControlFiles {
  vault: () => VaultSummary | null;
  /** Active document (path, unsaved changes) or null. */
  active: () => { path: string; dirty: boolean } | null;
  /** Tab model, null when tabs are disabled. */
  tabState: () => TabsState | null;
  activateTab: (id: string) => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  /** Switches to the vault folder (no dialog); rejects with the native error. */
  openVault: (path: string) => Promise<VaultSummary>;
  /** false when the drawing did not open. */
  openDrawing: (path: string, newTab: boolean) => Promise<boolean>;
  drawingExists: (path: string) => Promise<boolean>;
  folderExists: (path: string) => Promise<boolean>;
  /** Throwing core of the UI "new drawing" / "from JSON" flow. */
  createDrawing: (
    parent: string,
    name: string,
    sceneJson?: string,
  ) => Promise<void>;
  /** Throwing core of the UI rename/move; false = aborted by the user. */
  moveEntry: (
    from: string,
    to: string,
    rewriteLinks: boolean,
  ) => Promise<boolean>;
  trashEntry: (path: string) => Promise<void>;
}

type Handler = (params: unknown) => unknown;

export function createWindowMethods(
  getFiles: () => ControlFiles,
): Record<string, Handler> {
  /** The app rebuilds its ControlFiles each render: always call the latest. */
  const f = new Proxy({} as ControlFiles, {
    get: (_, key) => getFiles()[key as keyof ControlFiles],
  });
  const needVault = (): VaultSummary => {
    const v = f.vault();
    if (!v) {
      throw new ControlError("NO_VAULT", "No vault is open");
    }
    return v;
  };
  const needWritable = (): VaultSummary => {
    const v = needVault();
    if (v.readOnly) {
      throw new ControlError("READ_ONLY", "The vault is read-only");
    }
    return v;
  };
  const tabList = () => tabListResult(f.tabState(), f.active());

  return {
    "file.openState": (params) => {
      const path = relPath(stringParam(params, "path"), "path");
      const active = f.active();
      const state = f.tabState();
      return {
        open:
          active?.path === path || !!state?.tabs.some((t) => t.path === path),
        dirty: active?.path === path && active.dirty,
      };
    },
    "vault.open": async (params) => {
      const path = stringParam(params, "path");
      if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path)) {
        throw new ControlError("INVALID_PARAMS", "path must be absolute");
      }
      const v = await f.openVault(path);
      return { name: v.name, path: v.path, readOnly: v.readOnly };
    },
    "file.open": async (params) => {
      needVault();
      const path = relPath(stringParam(params, "path"), "path");
      if (!(await f.drawingExists(path))) {
        throw new ControlError("NOT_FOUND", `No such drawing ${path}`, {
          path,
        });
      }
      const newTab = objectParams(params).newTab === true;
      if (!(await f.openDrawing(path, newTab))) {
        throw new ControlError("IO_ERROR", `Could not open ${path}`, { path });
      }
      return { path, opened: true };
    },
    "file.create": async (params) => {
      needWritable();
      const p = objectParams(params);
      const path = withExt(relPath(stringParam(params, "path"), "path"));
      const { parent, name } = splitPath(path);
      let sceneJson: string | undefined;
      if (p.scene !== undefined) {
        if (!p.scene || typeof p.scene !== "object" || Array.isArray(p.scene)) {
          throw new ControlError("INVALID_PARAMS", "scene must be an object");
        }
        sceneJson = JSON.stringify(p.scene);
      }
      if (parent && !(await f.folderExists(parent))) {
        throw new ControlError("NOT_FOUND", `No such folder ${parent}`, {
          path: parent,
        });
      }
      await f.createDrawing(parent, name, sceneJson);
      return { path };
    },
    "file.move": async (params) => {
      needWritable();
      const from = relPath(stringParam(params, "from"), "from");
      const rewriteLinks = objectParams(params).rewriteLinks !== false;
      const to = moveDestination(from, stringParam(params, "to"));
      if (to !== from && !(await f.moveEntry(from, to, rewriteLinks))) {
        throw new ControlError("CONFLICT", "The move was cancelled", {
          from,
          to,
        });
      }
      return { from, to };
    },
    "file.trash": async (params) => {
      needWritable();
      const path = relPath(stringParam(params, "path"), "path");
      await f.trashEntry(path);
      return { path, trashed: true };
    },
    "tab.list": tabList,
    "tab.focus": async (params) => {
      const id = resolveTabId(f.tabState(), params, true);
      await f.activateTab(id);
      if (f.tabState()?.activeId !== id) {
        throw new ControlError("UNAVAILABLE", "The tab could not be focused", {
          id,
        });
      }
      return { id };
    },
    "tab.close": async (params) => {
      const id = resolveTabId(f.tabState(), params, false);
      await f.closeTab(id);
      if (f.tabState()?.tabs.some((t) => t.id === id)) {
        throw new ControlError("UNAVAILABLE", "The tab could not be closed", {
          id,
        });
      }
      return { closed: true };
    },
  };
}
