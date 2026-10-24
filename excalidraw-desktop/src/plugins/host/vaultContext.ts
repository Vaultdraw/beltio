/** `ctx.vault`: the gateway rows `vault.list`, `file.read` and `file.write` with checks first. */
import { serializeAsJSON } from "@excalidraw/excalidraw";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  checkVaultPath,
  requirePermission,
} from "../../../../sdk/api/testing/vault";
import { utf8Length } from "../../../../sdk/api/testing/rules";
import { buildElements, toSceneElement, validateOps } from "../../sceneOps";
import { getWorkspaceBridge } from "../workspaceBridge";

import { createGateway } from "./gateway";

import type { SceneElement, SceneOp, VaultApi, VaultEntry } from "../api";
import type { PluginRuntime } from "./types";

interface ReadReply {
  path: string;
  revision: string;
  scene: { elements?: ExcalidrawElement[] };
}

const isBound = (e: ExcalidrawElement) =>
  e.type === "text" && !!(e as { containerId?: string | null }).containerId;

export function createVaultApi(rt: PluginRuntime): VaultApi {
  const id = rt.info.id;
  const call = createGateway(id);
  // Read at call time: an update can change the declared permissions.
  const need = (method: string, permission: "vault.read" | "vault.write") =>
    requirePermission(id, rt.info.permissions, method, permission);
  return {
    info: () => getWorkspaceBridge()?.vault() ?? null,
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
      // Refs-free ops only: nothing exists yet to update or delete.
      const valid = validateOps(ops, new Map());
      const adds = valid.flatMap((op) => (op.op === "add" ? [op.element] : []));
      const elements = buildElements(adds, { x: 0, y: 0 });
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
        ids: elements.filter((e) => !isBound(e)).map((e) => e.id),
      };
    },
  };
}
