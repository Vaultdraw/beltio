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
      // Read at call time: an update can change the declared permissions.
      if (
        name === "vault.changed" &&
        !rt.info.permissions.includes("vault.read")
      ) {
        reportPluginError(
          id,
          permissionError(id, "vault.changed", "vault.read"),
          "events.on",
        );
        return NOOP;
      }
      return inner.on(name, cb);
    },
  };
}
