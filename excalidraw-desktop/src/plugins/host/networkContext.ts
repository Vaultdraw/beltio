/**
 * `ctx.network` (API 0.31.0): the gateway rows `network.askImages` and `network.fetchImage`, with
 * the permission `network.images` checked here first, as Rust checks it. Bodies are raw bytes
 * (`plugin_call_raw`): see `plugins/gateway.rs` `network_call`. The consent dialog and the
 * download guards (https only, no private address, 10 MiB, image bytes) are native.
 */
import { PluginApiError } from "../../../../sdk/api/shared/rules";
import { requirePermission } from "../../../../sdk/api/shared/vaultPaths";

import { createRawGateway } from "./gateway";

import type { NetworkApi } from "../api";
import type { PluginRuntime } from "./types";

const encoder = new TextEncoder();

export function createNetworkApi(rt: PluginRuntime): NetworkApi {
  const id = rt.info.id;
  const raw = createRawGateway(id);
  // Read at call time: an update can change the declared permissions.
  const need = (method: string) =>
    requirePermission(id, rt.info.permissions, method, "network.images");
  return {
    async askImages(urls) {
      need("network.askImages");
      if (!Array.isArray(urls) || urls.some((u) => typeof u !== "string")) {
        throw new PluginApiError(
          "INVALID_ARGUMENT",
          "urls must be a list of addresses",
        );
      }
      const answer = await raw(
        "network.askImages",
        encoder.encode(JSON.stringify({ urls })),
      );
      return answer[0] === 1;
    },
    async fetchImage(url) {
      need("network.fetchImage");
      if (typeof url !== "string" || url === "" || url.length > 2048) {
        throw new PluginApiError(
          "INVALID_ARGUMENT",
          "url must be an address of at most 2048 characters",
        );
      }
      return raw("network.fetchImage", encoder.encode(url));
    },
  };
}
