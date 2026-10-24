/**
 * `ctx.vault` and `ctx.workspace` of the mock host, and the rules the app's
 * host shares with it: the path checks (the same cases as the Rust side's
 * `check_plugin_path`, tied by sdk/api/test/vault-paths.json) and the
 * permission refusal.
 */
import { PluginApiError, utf8Length, validateOps } from "./rules";

import type {
  PluginPermission,
  SceneElement,
  SceneElementType,
  SceneOp,
  VaultApi,
  VaultEntry,
  WorkspaceApi,
} from "@vaultdraw/api";
import type {
  FakeElement,
  FakeElementInput,
  FakeVault,
  FakeWorkspace,
} from "./types";

export const MAX_PLUGIN_PATH = 1024;
const MAX_SEGMENT = 255;
const DRAWING_SUFFIX = ".excalidraw";
const META_DIR = ".excalidraw-vault";
const RESERVED = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);
const BAD_CHARS = /[<>:"|?*]/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const invalid = (message: string) =>
  new PluginApiError("INVALID_PATH", message);

export type VaultPathKind = "file" | "folder";

/**
 * Throws INVALID_PATH unless `path` is acceptable for a plugin call. A file
 * must be a `.excalidraw` drawing; a folder may be empty (the vault root).
 * Whether the entry exists is decided by the call that follows.
 */
export const checkVaultPath = (path: unknown, kind: VaultPathKind): string => {
  if (typeof path !== "string") {
    throw new PluginApiError("INVALID_ARGUMENT", "A path must be a string");
  }
  if (path === "") {
    if (kind === "folder") {
      return path;
    }
    throw invalid("A drawing path is required");
  }
  if (utf8Length(path) > MAX_PLUGIN_PATH) {
    throw invalid("Path is longer than 1024 bytes");
  }
  const parts = path.split("/");
  if (parts.some((s) => s.startsWith("."))) {
    throw invalid(
      "Plugins cannot use paths with a segment that starts with a dot",
    );
  }
  if (kind === "file" && !path.toLowerCase().endsWith(DRAWING_SUFFIX)) {
    throw invalid("Drawing paths must end in .excalidraw");
  }
  if (path.includes("\\") || path.includes("\0")) {
    throw invalid(
      "Path must be a bounded vault-relative path using forward slashes",
    );
  }
  for (const part of parts) {
    if (
      part === "" ||
      utf8Length(part) > MAX_SEGMENT ||
      part.endsWith(".") ||
      part.endsWith(" ") ||
      CONTROL.test(part) ||
      BAD_CHARS.test(part) ||
      RESERVED.has(part.split(".")[0].toUpperCase()) ||
      part.toLowerCase() === META_DIR
    ) {
      throw invalid("Path contains an invalid component");
    }
  }
  return path;
};

/** The PERMISSION error of a call whose permission plugin.toml does not declare. */
export const permissionError = (
  pluginId: string,
  method: string,
  permission: PluginPermission,
): PluginApiError =>
  Object.assign(
    new PluginApiError(
      "PERMISSION",
      `${pluginId}: ${method} needs the permission "${permission}", which plugin.toml does not declare`,
    ),
    { permission },
  );

/** Throws PERMISSION unless `declared` holds `permission`. */
export const requirePermission = (
  pluginId: string,
  declared: readonly string[],
  method: string,
  permission: PluginPermission,
): void => {
  if (!declared.includes(permission)) {
    throw permissionError(pluginId, method, permission);
  }
};

// --- the mock vault ---------------------------------------------------------

interface Stored {
  elements: FakeElement[];
  revision: number;
  modifiedAt: number;
}

const KNOWN: ReadonlySet<string> = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
  "freedraw",
  "image",
  "frame",
]);

let counter = 0;

const toFake = (input: FakeElementInput): FakeElement => ({
  ...input,
  id: input.id ?? `vault-${++counter}`,
  type: input.type,
  x: input.x ?? 0,
  y: input.y ?? 0,
  width: input.width ?? 100,
  height: input.height ?? 100,
});

const project = (el: FakeElement): SceneElement => {
  const out: { -readonly [K in keyof SceneElement]: SceneElement[K] } = {
    id: el.id,
    type: (KNOWN.has(el.type) ? el.type : "other") as SceneElementType,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    angle: 0,
  };
  if (el.type === "text" && el.text !== undefined) {
    out.text = el.text;
  }
  if (el.strokeColor !== undefined) {
    out.strokeColor = el.strokeColor;
  }
  if (el.backgroundColor !== undefined) {
    out.backgroundColor = el.backgroundColor;
  }
  return Object.freeze(out);
};

export interface VaultModel {
  fake: FakeVault;
  workspace: FakeWorkspace;
  /** `ctx.vault` of one plugin. */
  vaultApi(pluginId: string, permissions: readonly string[]): VaultApi;
  /** `ctx.workspace`: `open` makes the drawing active through the host. */
  workspaceApi(host: {
    activePath(): string | null;
    opened(path: string): void;
  }): WorkspaceApi;
  reset(): void;
}

const DEFAULT_INFO = { name: "mock-vault", readOnly: false };

/** An in-memory vault: drawings by path, seedable, with the app's error codes. */
export function createVaultModel(): VaultModel {
  const drawings = new Map<string, Stored>();
  let info: { name: string; readOnly: boolean } | null = { ...DEFAULT_INFO };
  let opened: { path: string; newTab: boolean }[] = [];

  const needVault = () => {
    if (!info) {
      throw new PluginApiError("NO_VAULT", "No vault is open");
    }
    return info;
  };
  const store = (els: readonly FakeElementInput[]): Stored => ({
    elements: els.map(toFake),
    revision: 1,
    modifiedAt: Date.now(),
  });

  const fake: FakeVault = {
    seed(next) {
      drawings.clear();
      for (const [path, els] of Object.entries(next)) {
        drawings.set(checkVaultPath(path, "file"), store(els));
      }
    },
    drawings() {
      return Object.fromEntries(
        [...drawings].map(([p, d]) => [p, [...d.elements]]),
      );
    },
    setVault(next) {
      info = next ? { ...next } : null;
    },
  };
  const workspace: FakeWorkspace = {
    opened: () => opened.map((o) => ({ ...o })),
  };

  const list = (dir: string): VaultEntry[] => {
    const base = dir === "" ? "" : `${dir}/`;
    const folders = new Map<string, VaultEntry>();
    const files: VaultEntry[] = [];
    let any = dir === "";
    for (const [path, d] of drawings) {
      if (!path.startsWith(base)) {
        continue;
      }
      any = true;
      const rest = path.slice(base.length);
      const slash = rest.indexOf("/");
      if (slash >= 0) {
        const name = rest.slice(0, slash);
        folders.set(name, {
          path: `${base}${name}`,
          name,
          kind: "folder",
          modifiedAt: d.modifiedAt,
          size: 0,
        });
      } else {
        files.push({
          path,
          name: rest,
          kind: "drawing",
          modifiedAt: d.modifiedAt,
          size: JSON.stringify(d.elements).length,
        });
      }
    }
    if (!any) {
      throw new PluginApiError("NOT_FOUND", "Directory not found");
    }
    const byName = (a: VaultEntry, b: VaultEntry) =>
      a.name.localeCompare(b.name);
    return [...[...folders.values()].sort(byName), ...files.sort(byName)];
  };

  return {
    fake,
    workspace,
    vaultApi(pluginId, permissions) {
      return {
        info: () => (info ? { ...info } : null),
        async list(dir = "") {
          requirePermission(pluginId, permissions, "vault.list", "vault.read");
          checkVaultPath(dir, "folder");
          needVault();
          return list(dir);
        },
        async readDrawing(path) {
          requirePermission(pluginId, permissions, "file.read", "vault.read");
          checkVaultPath(path, "file");
          needVault();
          const d = drawings.get(path);
          if (!d) {
            throw new PluginApiError("NOT_FOUND", "Drawing not found");
          }
          return {
            elements: Object.freeze(d.elements.map(project)),
            revision: `r${d.revision}`,
          };
        },
        async createDrawing(path, ops: readonly SceneOp[]) {
          requirePermission(pluginId, permissions, "file.write", "vault.write");
          checkVaultPath(path, "file");
          validateOps(ops, new Map());
          const v = needVault();
          if (v.readOnly) {
            throw new PluginApiError("READ_ONLY", "The vault is read-only");
          }
          if (drawings.has(path)) {
            throw new PluginApiError(
              "NAME_COLLISION",
              "A drawing with that name already exists",
            );
          }
          const made = store(
            ops.flatMap((op) => (op.op === "add" ? [op.element] : [])),
          );
          drawings.set(path, made);
          return {
            path,
            revision: `r${made.revision}`,
            ids: made.elements.map((e) => e.id),
          };
        },
      };
    },
    workspaceApi(host) {
      return {
        async open(path, opts) {
          checkVaultPath(path, "file");
          needVault();
          if (!drawings.has(path)) {
            throw new PluginApiError("NOT_FOUND", "Drawing not found");
          }
          opened.push({ path, newTab: opts?.newTab === true });
          host.opened(path);
        },
        activePath: () => host.activePath(),
      };
    },
    reset() {
      drawings.clear();
      info = { ...DEFAULT_INFO };
      opened = [];
    },
  };
}
