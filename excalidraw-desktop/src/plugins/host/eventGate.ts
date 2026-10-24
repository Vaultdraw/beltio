/** `ctx.events` with the permission check of `vault.changed` in front. */
import { permissionError } from "../../../../sdk/api/testing/vault";

import { reportPluginError } from "./errors";
import { createEventsApi } from "./sceneContext";

import type { Disposable, PluginContext } from "../api";
import type { PluginRuntime } from "./types";

const NOOP: Disposable = { dispose() {} };

export function createGatedEventsApi(
  rt: PluginRuntime,
  track: (fn: () => void) => Disposable,
  isLive: () => boolean,
): PluginContext["events"] {
  const id = rt.info.id;
  const inner = createEventsApi(id, track, isLive);
  return {
    on(name, cb) {
      if (name !== "vault.changed") {
        return inner.on(name, cb);
      }
      const allowed = () => rt.info.permissions.includes("vault.read");
      if (!allowed()) {
        reportPluginError(
          id,
          permissionError(id, "vault.changed", "vault.read"),
          "events.on",
        );
        return NOOP;
      }
      // Checked again per event: an update can remove the permission.
      return inner.on(name, ((payload: never) => {
        if (allowed()) {
          (cb as (p: never) => void)(payload);
        }
      }) as typeof cb);
    },
  };
}
