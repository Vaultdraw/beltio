/**
 * `plugin.commands` and `plugin.run`: the plugins' declared commands over the control socket.
 * Reads the plugin list (manifests), so a disabled plugin still shows, as `enabled: false`.
 */
import { getCommand } from "../commands/commands";

import { ControlError } from "./errors";
import { objectParams, stringParam } from "./params";

import type { CommandRunner } from "../commands/useCommands";

type Runner = Pick<CommandRunner, "run" | "isAvailable"> & {
  failedClauses?: (id: string) => string[];
};

/** Loaded on first use: the plugin host stays out of the bridge's startup graph. */
const pluginsState = async () =>
  (await import("../plugins/host/pluginsState")).getPluginsState();

export function createPluginMethods(runner: () => Runner) {
  return {
    "plugin.commands": async (params: unknown) => {
      const only = objectParams(params ?? {}).plugin;
      if (only !== undefined && typeof only !== "string") {
        throw new ControlError("INVALID_PARAMS", "plugin must be a string");
      }
      const state = await pluginsState();
      const plugins = state.plugins
        .filter((p) => only === undefined || p.id === only)
        .map((p) => ({
          id: p.id,
          name: p.name,
          version: p.version,
          enabled: state.runtime[p.id]?.enabled ?? false,
          state: state.runtime[p.id]?.state ?? "idle",
          commands: p.contributes.commands.map((c) => ({
            id: `${p.id}.${c.id}`,
            title: c.title,
            keys: c.keys,
            palette: c.palette,
          })),
        }));
      if (only !== undefined && plugins.length === 0) {
        throw new ControlError("NOT_FOUND", `Unknown plugin ${only}`, {
          plugin: only,
        });
      }
      return { plugins };
    },
    "plugin.run": async (params: unknown) => {
      const id = stringParam(params, "id");
      const state = await pluginsState();
      const owner = state.plugins.find(
        (p) =>
          id.startsWith(`${p.id}.`) &&
          p.contributes.commands.some((c) => `${p.id}.${c.id}` === id),
      );
      if (!owner) {
        throw new ControlError("NOT_FOUND", `No plugin command ${id}`, { id });
      }
      const rt = state.runtime[owner.id];
      if (!rt?.enabled || rt.state === "disabled" || rt.state === "failed") {
        throw new ControlError(
          "UNAVAILABLE",
          `Plugin ${owner.id} is not enabled`,
          { id, plugin: owner.id },
        );
      }
      const r = runner();
      if (!getCommand(id) || !r.run(id)) {
        throw new ControlError("UNAVAILABLE", `Command ${id} is unavailable`, {
          id,
          failed: r.failedClauses?.(id) ?? [],
        });
      }
      return { ran: true, id, plugin: owner.id };
    },
  };
}
