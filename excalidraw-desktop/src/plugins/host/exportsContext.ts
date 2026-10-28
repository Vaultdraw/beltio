/**
 * `ctx.vault.exports`: renders a drawing with the app's own SVG and PNG export and writes the
 * image into the vault through the `export.*` gateway rows (Rust checks the path, the permission
 * and the vault). The renderer loads on the first `render`, so a plugin that never exports pays
 * nothing.
 */
import {
  checkVaultPath,
  requirePermission,
} from "../../../../sdk/api/shared/vaultPaths";
import { PluginApiError } from "../../../../sdk/api/shared/rules";

import { createGateway, createRawGateway } from "./gateway";

import type { VaultExportsApi } from "../api";
import type { PluginRuntime } from "./types";

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const IMAGE = /\.(svg|png)$/i;

/** The raw gateway body of an `export.*` row: `u32 big-endian JSON length | JSON | bytes`. */
export function exportBody(
  head: Record<string, string>,
  bytes?: Uint8Array,
): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(head));
  const out = new Uint8Array(4 + json.length + (bytes?.length ?? 0));
  new DataView(out.buffer).setUint32(0, json.length);
  out.set(json, 4);
  if (bytes) {
    out.set(bytes, 4 + json.length);
  }
  return out;
}

export function createExportsApi(rt: PluginRuntime): VaultExportsApi {
  const id = rt.info.id;
  const call = createGateway(id);
  const raw = createRawGateway(id);
  const need = (method: string, permission: "vault.read" | "vault.write") =>
    requirePermission(id, rt.info.permissions, method, permission);
  return {
    async render(path, to, options) {
      need("file.read", "vault.read");
      need("export.write", "vault.write");
      checkVaultPath(path, "file");
      checkVaultPath(to, "image");
      const format = options?.format;
      if (format !== "svg" && format !== "png") {
        throw new PluginApiError("INVALID_ARGUMENT", "format is svg or png");
      }
      if (!to.toLowerCase().endsWith(`.${format}`)) {
        throw new PluginApiError(
          "INVALID_PATH",
          "The path must end in the export format",
        );
      }
      const scale = options.scale ?? 1;
      if (!Number.isFinite(scale) || scale < 1 || scale > 3) {
        throw new PluginApiError(
          "INVALID_ARGUMENT",
          "scale is a number from 1 to 3",
        );
      }
      const reply = await call<{ scene: unknown }>("file.read", { path });
      const [{ renderExport }, { ExportError }] = await Promise.all([
        import("../../export/renderExport"),
        import("../../export/exportError"),
      ]);
      let out;
      try {
        out = await renderExport(
          JSON.stringify(reply.scene),
          baseName(path),
          format,
          {
            scale,
            background: options.background ?? true,
            embedScene: false,
            pattern: true,
            dark: options.dark ?? false,
          },
          window,
        );
      } catch (e) {
        if (e instanceof ExportError && e.code === "EMPTY") {
          return null;
        }
        throw e;
      }
      await raw("export.write", exportBody({ path: to }, out.bytes));
      return { path: to, size: out.bytes.length };
    },
    async move(from, to) {
      need("export.move", "vault.write");
      const kind = IMAGE.test(from) ? "image" : "imageFolder";
      checkVaultPath(from, kind);
      checkVaultPath(to, kind);
      const reply = await raw("export.move", exportBody({ from, to }));
      return reply[0] === 1;
    },
    async remove(path) {
      need("export.remove", "vault.write");
      checkVaultPath(path, IMAGE.test(path) ? "image" : "imageFolder");
      const reply = await raw("export.remove", exportBody({ path }));
      return reply[0] === 1;
    },
  };
}
