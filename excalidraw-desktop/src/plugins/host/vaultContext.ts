/** `ctx.vault`: the gateway rows `vault.list`, `file.read` and `file.write` with checks first. */
import { serializeAsJSON } from "@excalidraw/excalidraw";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  checkVaultPath,
  requirePermission,
} from "../../../../sdk/api/shared/vaultPaths";
import { utf8Length } from "../../../../sdk/api/shared/rules";
import {
  buildBatch,
  dataKeyFor,
  toSceneElement,
  validateOps,
} from "../../sceneOps";
import { getPreferences } from "../../vault/preferences";
import { getWorkspaceBridge } from "../workspaceBridge";

import { createGateway, createRawGateway } from "./gateway";

import type { SceneElement, SceneOp, VaultApi, VaultEntry } from "../api";
import type { PluginRuntime } from "./types";

interface ReadReply {
  path: string;
  revision: string;
  scene: { elements?: ExcalidrawElement[] };
}

export function createVaultApi(rt: PluginRuntime): VaultApi {
  const id = rt.info.id;
  const call = createGateway(id);
  const raw = createRawGateway(id);
  // Read at call time: an update can change the declared permissions.
  const need = (method: string, permission: "vault.read" | "vault.write") =>
    requirePermission(id, rt.info.permissions, method, permission);
  return {
    info: () => getWorkspaceBridge()?.vault() ?? null,
    table: {
      async read() {
        need("vault.settings.read", "vault.read");
        return call<Record<string, unknown>>("vault.settings.read");
      },
      async update(changes) {
        need("vault.settings.update", "vault.write");
        await call("vault.settings.update", { changes });
      },
    },
    graph: {
      async read() {
        need("vault.graph", "vault.read");
        return raw("vault.graph");
      },
      layout: {
        async load() {
          need("vault.graphLayout.load", "vault.read");
          return raw("vault.graphLayout.load");
        },
        async save(bytes) {
          need("vault.graphLayout.save", "vault.write");
          await raw("vault.graphLayout.save", bytes);
        },
      },
    },
    async list(dir = "") {
      need("vault.list", "vault.read");
      checkVaultPath(dir, "folder");
      const reply = await call<{ entries: VaultEntry[] }>("vault.list", {
        dir,
      });
      return reply.entries;
    },
    async readDrawing(path) {
      need("file.read", "vault.read");
      checkVaultPath(path, "file");
      const reply = await call<ReadReply>("file.read", { path });
      const elements: SceneElement[] = [];
      for (const el of reply.scene.elements ?? []) {
        if (!el.isDeleted) {
          elements.push(Object.freeze(toSceneElement(el)));
        }
      }
      return { elements: Object.freeze(elements), revision: reply.revision };
    },
    async createDrawing(path, ops: readonly SceneOp[]) {
      need("file.write", "vault.write");
      checkVaultPath(path, "file");
      // add and group ops only: nothing exists yet to update or delete.
      const dataKey = dataKeyFor(id, rt.info.dataKey);
      const valid = validateOps(ops, new Map(), {
        dataKey,
        maxOps: getPreferences().pluginsSceneMaxOps,
      });
      const built = buildBatch(valid, { x: 0, y: 0 }, dataKey, new Map());
      const elements = built.created;
      const scene = JSON.parse(
        serializeAsJSON(elements, {}, {}, "local"),
      ) as Record<string, unknown>;
      const reply = await call<{ path: string; revision: string }>(
        "file.write",
        { path, scene, expectedRevision: null },
        utf8Length(JSON.stringify(scene)),
      );
      return {
        path: reply.path ?? path,
        revision: reply.revision,
        ids: built.ids,
        refs: built.refs,
      };
    },
  };
}
