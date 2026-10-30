/**
 * `ctx.secret` (API 1.1.0, experimental): the gateway rows `secret.set`, `secret.has` and
 * `secret.delete` (permission `secret`). There is no read-back: Rust adds the secret to a request
 * (`ctx.net` `auth`), so the page never holds a stored key.
 */
import { createSecretClient } from "../../../../sdk/api/shared/netClient";
import { requirePermission } from "../../../../sdk/api/shared/vaultPaths";

import { createRawGateway } from "./gateway";

import type { SecretApi } from "../api";
import type { PluginRuntime } from "./types";

export function createSecretApi(rt: PluginRuntime): SecretApi {
  const id = rt.info.id;
  return createSecretClient(createRawGateway(id), (method) =>
    requirePermission(id, rt.info.permissions, method, "secret"),
  );
}
