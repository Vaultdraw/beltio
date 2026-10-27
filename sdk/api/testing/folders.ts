/**
 * `ctx.folders` of the mock host, over the shared in-memory store
 * (sdk/api/shared/fakeFolders.ts): the same handles, limits and error codes
 * as the app's gateway, with the permission `folders.import` checked first.
 */
import { createFakeFolderStore } from "../shared/fakeFolders";
import { PluginApiError, utf8Length } from "../shared/rules";
import { checkVaultPath, requirePermission } from "../shared/vaultPaths";

import type { FakeFolderStore } from "../shared/fakeFolders";
import type {
  FolderEntry,
  FoldersApi,
  SourceFolder,
  TargetFolder,
} from "@vaultdraw/api";
import type { FakeFolders } from "./types";
import type { VaultModel } from "./vault";

const PERMISSION = "folders.import";

const bad = (message: string) =>
  new PluginApiError("INVALID_ARGUMENT", message);

const checkRelative = (path: unknown): string => {
  if (typeof path !== "string" || path === "") {
    throw bad("path must be a non-empty string");
  }
  const parts = path.split("/");
  if (
    path.includes("\\") ||
    path.includes("\0") ||
    parts.some((p) => p === "" || p === "." || p === ".." || p.startsWith("."))
  ) {
    throw new PluginApiError(
      "INVALID_PATH",
      "Path must be relative, use forward slashes, and have no dot segments",
    );
  }
  return path;
};

const title = (v: unknown): string | undefined => {
  if (v === undefined) {
    return undefined;
  }
  if (typeof v !== "string" || v.length > 200) {
    throw bad("title must be a string of at most 200 characters");
  }
  return v;
};

const fromBase64 = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
};

export interface FoldersModel {
  fake: FakeFolders;
  store: FakeFolderStore;
  api(pluginId: string, permissions: readonly string[]): FoldersApi;
  reset(): void;
}

export function createFoldersModel(
  vault: VaultModel,
  vaultState: {
    open(): boolean;
    readOnly(): boolean;
    hasDrawing(path: string): boolean;
    putDrawing(path: string, scene: object): void;
  },
): FoldersModel {
  const store = createFakeFolderStore(vaultState);
  const fake: FakeFolders = {
    setSource(folder) {
      store.sourcePick = folder;
    },
    setNewVault(name) {
      store.newVaultPick = name;
    },
    targets: () =>
      Object.values(store.targets).map((t) => ({
        ...t,
        files: { ...t.files },
      })),
  };
  const call = <T>(
    method: string,
    params: Record<string, unknown>,
    _bytes = 0,
  ): Promise<T> => Promise.resolve(store.call(method, params) as T);

  return {
    fake,
    store,
    reset: () => store.reset(),
    api(pluginId, permissions) {
      const need = (method: string) =>
        requirePermission(pluginId, permissions, method, PERMISSION);
      const sources = new WeakMap<object, string>();
      const source = (handle: string, name: string): SourceFolder => {
        const folder: SourceFolder = {
          name,
          async list() {
            need("folders.list");
            return (
              await call<{ entries: FolderEntry[] }>("folders.list", { handle })
            ).entries;
          },
          async readText(path) {
            need("folders.readText");
            const rel = checkRelative(path);
            return (
              await call<{ text: string }>("folders.readText", {
                handle,
                path: rel,
              })
            ).text;
          },
          async readBytes(path) {
            need("folders.readBytes");
            const rel = checkRelative(path);
            return fromBase64(
              (
                await call<{ base64: string }>("folders.readBytes", {
                  handle,
                  path: rel,
                })
              ).base64,
            );
          },
        };
        sources.set(folder, handle);
        return Object.freeze(folder);
      };
      const target = (
        handle: string,
        name: string,
        kind: TargetFolder["kind"],
        vaultPath: string | null,
      ): TargetFolder => {
        const folder: TargetFolder = {
          name,
          kind,
          async writeDrawing(path, scene) {
            need("folders.writeDrawing");
            checkVaultPath(path, "file");
            if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
              throw bad(
                "scene must be an object (as pages.buildScene returns)",
              );
            }
            await call(
              "folders.writeDrawing",
              { handle, path, scene },
              utf8Length(JSON.stringify(scene)),
            );
          },
          async copyFrom(from, fromPath, to) {
            need("folders.copy");
            const sourceHandle = sources.get(from as object);
            if (!sourceHandle) {
              throw bad("source must be a folder from folders.pickSource");
            }
            await call("folders.copy", {
              source: sourceHandle,
              from: checkRelative(fromPath),
              target: handle,
              to: checkRelative(to),
            });
          },
          async open() {
            if (kind === "newVault") {
              vault.openedVault(store.root(handle));
            } else {
              vault.revealed(vaultPath ?? "");
            }
          },
        };
        return Object.freeze(folder);
      };
      return {
        async pickSource(options) {
          need("folders.pickSource");
          const t = title(options?.title);
          const reply = await call<{ handle: string; name: string } | null>(
            "folders.pickSource",
            t === undefined ? {} : { title: t },
          );
          return reply ? source(reply.handle, reply.name) : null;
        },
        async pickTarget(options) {
          if (!options || typeof options !== "object") {
            throw bad("options must be an object");
          }
          if (options.kind === "newVault") {
            need("folders.pickNewVault");
            const t = title(options.title);
            const reply = await call<{ handle: string; name: string } | null>(
              "folders.pickNewVault",
              t === undefined ? {} : { title: t },
            );
            return reply
              ? target(reply.handle, reply.name, "newVault", null)
              : null;
          }
          if (options.kind === "vaultFolder") {
            need("folders.vaultTarget");
            const path = checkVaultPath(options.path, "folder");
            const info = vault.needVault();
            if (info.readOnly) {
              throw new PluginApiError("READ_ONLY", "The vault is read-only");
            }
            const reply = await call<{ handle: string; name: string }>(
              "folders.vaultTarget",
              { path },
            );
            return target(reply.handle, reply.name, "vaultFolder", path);
          }
          throw bad('kind must be "newVault" or "vaultFolder"');
        },
      };
    },
  };
}
