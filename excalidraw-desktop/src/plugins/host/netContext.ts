/**
 * `ctx.net` (API 1.1.0, experimental): the gateway rows `net.open`, `net.read` and `net.close`
 * (permission `net`, raw bodies; see `plugins/net.rs`). The request is sent by Rust and pulled in
 * tagged chunks (`sdk/api/shared/netClient.ts`); closing a stream is the cancel.
 */
import { createNetClient } from "../../../../sdk/api/shared/netClient";
import { requirePermission } from "../../../../sdk/api/shared/vaultPaths";

import { createRawGateway } from "./gateway";

import type { NetApi } from "../api";
import type { PluginRuntime } from "./types";

export function createNetApi(rt: PluginRuntime): NetApi {
  const id = rt.info.id;
  return createNetClient(createRawGateway(id), () =>
    requirePermission(id, rt.info.permissions, "net.request", "net"),
  );
}
