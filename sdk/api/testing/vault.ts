/**
 * `ctx.vault` and `ctx.workspace` of the mock host. The path and permission
 * rules it shares with the app's host are in sdk/api/shared/vaultPaths.ts.
 */
import { PluginApiError } from "../shared/rules";
import { validateOps } from "../shared/sceneRules";
import { checkVaultPath, requirePermission } from "../shared/vaultPaths";

import type {
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

// --- the mock vault ---------------------------------------------------------

interface Stored {
  elements: FakeElement[];
  revision: number;
  modifiedAt: number;
  appState?: Record<string, unknown>;
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
  /** The page-document side: create-only writes with app state, saves, revisions. */
  has(path: string): boolean;
  /** Writes (or replaces, for a save) a drawing with editor elements and app state; returns the revision. */
  put(
    path: string,
    elements: readonly FakeElement[],
    appState: Record<string, unknown>,
    save?: boolean,
  ): string;
  revision(path: string): string | null;
  /** The open vault, or throws NO_VAULT. */
  needVault(): { name: string; readOnly: boolean };
  /** Records a `TargetFolder.open()`. */
  openedVault(path: string): void;
  revealed(path: string): void;
  /** `ctx.vault` of one plugin. */
  vaultApi(
    pluginId: string,
    permissions: readonly string[],
    dataKey?: string,
  ): VaultApi;
  /** `ctx.workspace`: `open` makes the drawing active through the host. */
  workspaceApi(host: {
    activePath(): string | null;
    opened(path: string): void;
  }): WorkspaceApi;
  reset(): void;
}

const DEFAULT_INFO = { name: "mock-vault", readOnly: false };

/** An in-memory vault: drawings by path, seedable, with the app's error codes. */
export function createVaultModel(
  /** `plugins.scene_max_ops` of the test (undefined: the app's default). */
  maxOps: () => number | undefined = () => undefined,
): VaultModel {
  const drawings = new Map<string, Stored>();
  let info: { name: string; readOnly: boolean } | null = { ...DEFAULT_INFO };
  let opened: { path: string; newTab: boolean }[] = [];
  let openedVaults: string[] = [];
  let revealedFolders: string[] = [];
  let saves: string[] = [];

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
    saves: () => [...saves],
    pageSetup: (path) =>
      drawings.get(path)?.appState?.pageSetup as
        | Record<string, unknown>
        | undefined,
  };
  const workspace: FakeWorkspace = {
    opened: () => opened.map((o) => ({ ...o })),
    openedVaults: () => [...openedVaults],
    revealed: () => [...revealedFolders],
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
    has: (path) => drawings.has(path),
    put(path, elements, appState, save = false) {
      const prev = drawings.get(path);
      const next: Stored = {
        elements: [...elements],
        revision: (prev?.revision ?? 0) + 1,
        modifiedAt: Date.now(),
        appState,
      };
      drawings.set(path, next);
      if (save) {
        saves.push(path);
      }
      return `r${next.revision}`;
    },
    revision(path) {
      const d = drawings.get(path);
      return d ? `r${d.revision}` : null;
    },
    needVault,
    openedVault(path) {
      openedVaults.push(path);
    },
    revealed(path) {
      revealedFolders.push(path);
    },
    vaultApi(pluginId, permissions, dataKey) {
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
          validateOps(ops, new Map(), {
            dataKey: dataKey ?? null,
            maxOps: maxOps(),
          });
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
          const addOps = ops.flatMap((op) => (op.op === "add" ? [op] : []));
          const made = store(addOps.map((op) => op.element));
          // As the app: data under the plugin's key, group ops as group ids.
          const byRef = new Map<string, number>();
          addOps.forEach((op, i) => {
            if (op.ref !== undefined) {
              byRef.set(op.ref, i);
            }
          });
          const els = made.elements.map((e, i) => {
            const { data, ...rest } = addOps[i].element;
            const out: Record<string, unknown> = {
              ...e,
              ...rest,
              groupIds: [],
            };
            delete out.data;
            if (data !== undefined && data !== null && dataKey) {
              out.customData = { [dataKey]: structuredClone(data) };
            }
            return out;
          });
          let groupSeq = 0;
          for (const op of ops) {
            if (op.op === "group") {
              const groupId = `vault-group-${++groupSeq}`;
              for (const m of op.ids) {
                const k = typeof m === "string" ? -1 : byRef.get(m.ref) ?? -1;
                if (k >= 0) {
                  els[k].groupIds = [...(els[k].groupIds as string[]), groupId];
                }
              }
            }
          }
          made.elements = els as unknown as FakeElement[];
          drawings.set(path, made);
          const ids = made.elements.map((e) => e.id);
          const refs: Record<string, string> = {};
          ops
            .flatMap((op) => (op.op === "add" ? [op] : []))
            .forEach((op, i) => {
              if (op.ref !== undefined) {
                refs[op.ref] = ids[i];
              }
            });
          return { path, revision: `r${made.revision}`, ids, refs };
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
      openedVaults = [];
      revealedFolders = [];
      saves = [];
    },
  };
}
