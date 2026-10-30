/**
 * `ctx.net` and `ctx.secret` of the mock host: script the provider with `net.respond`, read what
 * was sent in `net.requests`, and see stored keys in `net.secrets`. Nothing goes on the wire. The
 * permissions `net` and `secret` are checked first, as in the app.
 */
import { createFakeNet, fakeNetRow, type FakeNet } from "../shared/fakeNet";
import { createNetClient, createSecretClient } from "../shared/netClient";
import { permissionError } from "../shared/vaultPaths";

import type { NetApi, SecretApi } from "../src/index";

export type { FakeNet, FakeNetReply, FakeNetRequest } from "../shared/fakeNet";

export function createNetModel() {
  const fake: FakeNet = createFakeNet();
  const raw = (id: string) => (method: string, body?: Uint8Array) =>
    fakeNetRow(fake, id, method, body ?? new Uint8Array(0));
  return {
    fake,
    netApi(id: string, permissions: readonly string[]): NetApi {
      return createNetClient(raw(id), () => {
        if (!permissions.includes("net")) {
          throw permissionError(id, "net.request", "net");
        }
      });
    },
    secretApi(id: string, permissions: readonly string[]): SecretApi {
      return createSecretClient(raw(id), (method) => {
        if (!permissions.includes("secret")) {
          throw permissionError(id, method, "secret");
        }
      });
    },
    reset() {
      fake.respond = undefined;
      fake.requests = [];
      fake.secrets = {};
      fake.offline = undefined;
      fake.closed = [];
    },
  };
}
