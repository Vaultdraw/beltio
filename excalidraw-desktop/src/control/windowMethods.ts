/**
 * Window-side control methods for vault, files and tabs (C3). Pure: every
 * app effect is injected through ControlFiles; VaultApp supplies the same
 * throwing cores the UI handlers use.
 */
import { ExportError } from "../export/exportError";

import { ControlError } from "./errors";
import {
  boolParam,
  exportFormatParam,
  exportPaddingParam,
  exportScaleParam,
  moveDestination,
  objectParams,
  optionalStringParam,
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

export type ExportFormat = "png" | "svg" | "pdf";

export interface ExportRenderOptions {
  scale: number;
  dark: boolean;
  background: boolean;
  pattern: boolean;
  embedScene: boolean;
  pageShaped: boolean;
  /** Frame id or name to crop to (absent = the whole drawing). */
  frame?: string;
  /** Canvas padding in px (absent = the editor's default). */
  padding?: number;
}

/** Options a PDF export would ignore: refused instead (INVALID_PARAMS). */
const PDF_IGNORED = [
  "dark",
  "background",
  "scale",
  "embedScene",
  "pageShaped",
] as const;

/** Raw output cap: base64 adds a third and the JSON-RPC frame is 48 MiB. */
export const MAX_EXPORT_BYTES = 32 * 1024 * 1024;

/** Standard base64 of `bytes`, in chunks (no argument-count stack overflow). */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  const CHUNK = 0x6000; // multiple of 3: chunks concatenate without padding
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += btoa(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return out;
};

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
  /**
   * Renders the drawing off-screen through the explorer export path (flushing
   * the open drawing first). Rejects NOT_FOUND for a missing drawing.
   */
  exportDrawing: (
    path: string,
    format: ExportFormat,
    options: ExportRenderOptions,
  ) => Promise<{ bytes: Uint8Array; mime: string; fileName: string }>;
  /** [exportDrawing] with the output left in a Blob (for `spool: true`). */
  exportDrawingBlob: (
    path: string,
    format: ExportFormat,
    options: ExportRenderOptions,
  ) => Promise<{ blob: Blob; mime: string; fileName: string }>;
}

type Handler = (params: unknown) => unknown;

export function createWindowMethods(
  getFiles: () => ControlFiles,
  /** Streams a Blob to a spool file and returns its path (absent = spool unsupported). */
  spool?: (blob: Blob) => Promise<string>,
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

  /** Validates an `export.render` / `export.spool` request. */
  const exportRequest = (params: unknown) => {
    needVault();
    const path = relPath(stringParam(params, "path"), "path");
    const format = exportFormatParam(params);
    if (format === "pdf") {
      // PDF pages are fixed: light theme, background on, own resolution.
      const given = objectParams(params);
      for (const key of PDF_IGNORED) {
        if (given[key] !== undefined) {
          throw new ControlError(
            "INVALID_PARAMS",
            `${key} does not apply to pdf`,
          );
        }
      }
    }
    const frame = optionalStringParam(params, "frame");
    const padding = exportPaddingParam(params);
    if (format === "pdf" && frame !== undefined) {
      throw new ControlError("INVALID_PARAMS", "frames apply to png and svg");
    }
    if (format === "pdf" && padding !== undefined) {
      throw new ControlError(
        "INVALID_PARAMS",
        "padding applies to png and svg",
      );
    }
    const options: ExportRenderOptions = {
      scale: exportScaleParam(params),
      dark: boolParam(params, "dark", false),
      background: boolParam(params, "background", true),
      pattern: boolParam(params, "pattern", true),
      embedScene: boolParam(params, "embedScene", false),
      pageShaped: boolParam(params, "pageShaped", false),
      ...(frame === undefined ? {} : { frame }),
      ...(padding === undefined ? {} : { padding }),
    };
    return { path, format, options };
  };
  const exportFailure = (e: unknown, path: string) => {
    if (e instanceof ExportError) {
      const message =
        e.code === "EMPTY" ? "Cannot export an empty canvas" : e.message;
      return new ControlError("INVALID_FILE", message, { path });
    }
    return e;
  };

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
    "export.render": async (params) => {
      const { path, format, options } = exportRequest(params);
      let out;
      try {
        out = await f.exportDrawing(path, format, options);
      } catch (e) {
        throw exportFailure(e, path);
      }
      const size = out.bytes.length;
      if (size > MAX_EXPORT_BYTES) {
        throw new ControlError(
          "TOO_LARGE",
          "The export is larger than 32 MiB",
          {
            path,
            size,
          },
        );
      }
      return {
        path,
        fileName: out.fileName,
        mime: out.mime,
        size,
        bytes: bytesToBase64(out.bytes),
      };
    },
    // Same render, but the image stays in one Blob and goes to a spool file in
    // chunks: no copy through the reply and no size cap.
    "export.spool": async (params) => {
      const { path, format, options } = exportRequest(params);
      if (!spool) {
        throw new ControlError(
          "UNAVAILABLE",
          "This window cannot spool exports",
        );
      }
      let rendered;
      try {
        rendered = await f.exportDrawingBlob(path, format, options);
      } catch (e) {
        throw exportFailure(e, path);
      }
      return {
        path,
        fileName: rendered.fileName,
        mime: rendered.mime,
        size: rendered.blob.size,
        spool: await spool(rendered.blob),
      };
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
