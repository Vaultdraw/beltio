/**
 * `ctx.folders` (API 0.9.0): the gateway rows `folders.*` with the permission
 * `folders.import` checked here first, as Rust checks it. Handles are opaque
 * ids Rust holds for the session; a source handle has no write row, so the
 * source is never written.
 */
import { PluginApiError, utf8Length } from "../../../../sdk/api/shared/rules";
import {
  checkVaultPath,
  requirePermission,
} from "../../../../sdk/api/shared/vaultPaths";
import { getWorkspaceBridge } from "../workspaceBridge";

import { createGateway } from "./gateway";

import type {
  FolderEntry,
  FoldersApi,
  PickTargetOptions,
  SourceFolder,
  TargetFolder,
} from "../api";
import type { PluginRuntime } from "./types";

const PERMISSION = "folders.import";

const bad = (message: string) =>
  new PluginApiError("INVALID_ARGUMENT", message);

/** A relative path inside a source folder: "/"-separated, no dot segments, no "..". */
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

const fromBase64 = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
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

export function createFoldersApi(rt: PluginRuntime): FoldersApi {
  const id = rt.info.id;
  const call = createGateway(id);
  // Read at call time: an update can change the declared permissions.
  const need = (method: string) =>
    requirePermission(id, rt.info.permissions, method, PERMISSION);
  /** Source objects made here, to their handles (`copyFrom` takes only these). */
  const sources = new WeakMap<object, string>();

  const source = (handle: string, name: string): SourceFolder => {
    const folder: SourceFolder = {
      name,
      async list() {
        need("folders.list");
        const reply = await call<{ entries: FolderEntry[] }>("folders.list", {
          handle,
        });
        return reply.entries;
      },
      async readText(path) {
        need("folders.readText");
        const rel = checkRelative(path);
        const reply = await call<{ text: string }>("folders.readText", {
          handle,
          path: rel,
        });
        return reply.text;
      },
      async readBytes(path) {
        need("folders.readBytes");
        const rel = checkRelative(path);
        const reply = await call<{ base64: string }>("folders.readBytes", {
          handle,
          path: rel,
        });
        return fromBase64(reply.base64);
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
          throw bad("scene must be an object (as pages.buildScene returns)");
        }
        const text = JSON.stringify(scene);
        await call(
          "folders.writeDrawing",
          { handle, path, scene },
          utf8Length(text),
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
      async convertDrawing(from, fromPath, to) {
        need("folders.convertDrawing");
        const sourceHandle = sources.get(from as object);
        if (!sourceHandle) {
          throw bad("source must be a folder from folders.pickSource");
        }
        await call("folders.convertDrawing", {
          source: sourceHandle,
          from: checkRelative(fromPath),
          target: handle,
          to: checkRelative(to),
        });
      },
      async open() {
        const bridge = getWorkspaceBridge();
        if (!bridge) {
          throw new PluginApiError("NO_VAULT", "The app shell is not ready");
        }
        if (kind === "newVault") {
          await bridge.openVaultFolder(handle);
        } else {
          await bridge.revealFolder(vaultPath ?? "");
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
    async pickTarget(options: PickTargetOptions) {
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
        const bridge = getWorkspaceBridge();
        const vault = bridge?.vault();
        if (!vault) {
          throw new PluginApiError("NO_VAULT", "No vault is open");
        }
        if (vault.readOnly) {
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
}
