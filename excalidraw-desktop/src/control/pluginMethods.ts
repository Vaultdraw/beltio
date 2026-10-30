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

/**
 * The plugin list exists once the host has started. Official plugins are on by default but the
 * host stays asleep until something needs it, so every plugin method wakes it first: on a fresh
 * config `plugin commands`, `plugin methods` and `plugin call` must see them (hunter C-11).
 */
const startHost = async () =>
  (await import("../plugins/boot")).ensurePluginHost(window);

export const DEFAULT_METHOD_TIMEOUT_MS = 30_000;
/** A result larger than this (as JSON text) fails the call. */
export const MAX_METHOD_RESULT_BYTES = 4 * 1024 * 1024;

type State = Awaited<ReturnType<typeof pluginsState>>;
type Info = State["plugins"][number];

/** Whether the plugin may run now: enabled, not stopped by the host, consent given. */
const live = (state: State, info: Info) => {
  const rt = state.runtime[info.id];
  return (
    !!rt?.enabled &&
    rt.state !== "disabled" &&
    rt.state !== "failed" &&
    info.review.state !== "review" &&
    info.permissions.includes("control")
  );
};

const callerOf = (params: unknown): string => {
  const by = objectParams(params ?? {}).by;
  return typeof by === "string" ? by : "cli";
};

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () =>
        reject(
          new ControlError("TIMEOUT", `${what} did not answer in ${ms} ms`),
        ),
      ms,
    );
    p.then(resolve, reject).finally(() => clearTimeout(t));
  });

export function createPluginMethods(
  runner: () => Runner,
  ensureHost: () => Promise<void> = startHost,
) {
  return {
    "plugin.commands": async (params: unknown) => {
      const only = objectParams(params ?? {}).plugin;
      if (only !== undefined && typeof only !== "string") {
        throw new ControlError("INVALID_PARAMS", "plugin must be a string");
      }
      await ensureHost();
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
    "plugin.methods": async (params: unknown) => {
      const only = objectParams(params ?? {}).plugin;
      const ai = callerOf(params) === "mcp";
      await ensureHost();
      const state = await pluginsState();
      const methods = state.plugins
        .filter((p) => (only === undefined || p.id === only) && live(state, p))
        .flatMap((p) =>
          (p.contributes.methods ?? [])
            .filter((m) => !ai || m.mcp)
            .map((m) => ({
              plugin: p.id,
              method: m.id,
              title: m.title,
              description: m.description ?? null,
              params: m.params ?? null,
              mcp: m.mcp,
              write: m.write,
            })),
        );
      return { methods };
    },
    "plugin.call": async (params: unknown) => {
      const plugin = stringParam(params, "plugin");
      const method = stringParam(params, "method");
      const ai = callerOf(params) === "mcp";
      await ensureHost();
      const state = await pluginsState();
      const info = state.plugins.find((p) => p.id === plugin);
      const decl = info?.contributes.methods?.find((m) => m.id === method);
      // An AI app sees a method that is not offered to it as one that does not exist.
      if (!info || !decl || (ai && !decl.mcp)) {
        throw new ControlError("NOT_FOUND", `No method ${plugin}.${method}`, {
          plugin,
          method,
        });
      }
      if (!live(state, info)) {
        throw new ControlError(
          "UNAVAILABLE",
          `Plugin ${plugin} is not enabled or needs review`,
          { plugin },
        );
      }
      const { ensureActive, getRuntime } = await import(
        "../plugins/host/activation"
      );
      if (!(await ensureActive(plugin))) {
        throw new ControlError(
          "UNAVAILABLE",
          `Plugin ${plugin} could not be loaded`,
          { plugin },
        );
      }
      const handler = getRuntime(plugin)?.methods.get(method);
      if (!handler) {
        throw new ControlError(
          "UNAVAILABLE",
          `Method ${plugin}.${method} is declared but the plugin did not register it`,
          { plugin, method },
        );
      }
      const input = (params as Record<string, unknown>).params ?? {};
      const ms = decl.timeout_ms ?? DEFAULT_METHOD_TIMEOUT_MS;
      let result: unknown;
      try {
        result = await withTimeout(
          Promise.resolve().then(() => handler(input as never)),
          ms,
          `${plugin}.${method}`,
        );
      } catch (err) {
        if (err instanceof ControlError) {
          throw err;
        }
        const { errorText, logLine } = await import("../plugins/host/errors");
        logLine(plugin, "error", `method ${method} failed: ${errorText(err)}`);
        throw new ControlError(
          "PLUGIN_ERROR",
          `${plugin}.${method} failed: ${errorText(err)}`,
          { plugin, method },
        );
      }
      const text = result === undefined ? undefined : JSON.stringify(result);
      if (text === undefined) {
        throw new ControlError(
          "PLUGIN_ERROR",
          `${plugin}.${method} returned nothing (a method returns JSON)`,
          { plugin, method },
        );
      }
      if (text.length > MAX_METHOD_RESULT_BYTES) {
        throw new ControlError(
          "TOO_LARGE",
          `${plugin}.${method} returned more than ${MAX_METHOD_RESULT_BYTES} bytes`,
          { plugin, method },
        );
      }
      return { plugin, method, result: JSON.parse(text) as unknown };
    },
    "plugin.run": async (params: unknown) => {
      const id = stringParam(params, "id");
      await ensureHost();
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
