/**
 * The host side of `plugin_call`: one native round trip per call, timed and
 * counted per plugin and method in the cost view (over 50 ms counts as slow).
 * Rust checks the allowlist, the permission and the consent record
 * (src-tauri/src/plugins/gateway.rs); errors arrive as `{ code, message }`
 * and are rethrown as an Error with `code` (and any detail, such as `reason`).
 */
import { PluginApiError } from "../../../../sdk/api/shared/rules";

import { getPluginsBackend } from "./backend";
import { recordGatewayCall } from "./cost";

export type GatewayCall = <T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  bytes?: number,
) => Promise<T>;

/** An error from Rust (`{code, message, ...}`) as an Error with `code`. */
export const toApiError = (err: unknown): Error => {
  if (err instanceof Error) {
    return err;
  }
  if (err && typeof err === "object" && "code" in err) {
    const { code, message, ...detail } = err as Record<string, unknown>;
    return Object.assign(
      new PluginApiError(String(code), String(message ?? code)),
      detail,
    );
  }
  return new Error(String(err));
};

export const createGateway =
  (pluginId: string): GatewayCall =>
  async <T>(method: string, params?: Record<string, unknown>, bytes = 0) => {
    const t0 = performance.now();
    try {
      return (await getPluginsBackend().pluginCall(
        pluginId,
        method,
        params ?? null,
      )) as T;
    } catch (err) {
      throw toApiError(err);
    } finally {
      recordGatewayCall(pluginId, method, performance.now() - t0, bytes);
    }
  };

export type RawGatewayCall = (
  method: string,
  body?: Uint8Array,
) => Promise<Uint8Array>;

/** The binary twin of `createGateway`: `plugin_call_raw`, timed and counted the same way. */
export const createRawGateway =
  (pluginId: string): RawGatewayCall =>
  async (method, body) => {
    const t0 = performance.now();
    let size = body?.byteLength ?? 0;
    try {
      const out = await getPluginsBackend().pluginCallRaw(
        pluginId,
        method,
        body,
      );
      size += out.byteLength;
      return out;
    } catch (err) {
      throw toApiError(err);
    } finally {
      recordGatewayCall(pluginId, method, performance.now() - t0, size);
    }
  };
