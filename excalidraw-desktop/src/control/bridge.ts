/**
 * WebView side of the control API: answers "control-request" events from the
 * Rust server. Pure: listen/invoke and the app state are injected.
 */
import { getCommand } from "../commands/commands";
import { spoolBlob } from "../export/spoolBlob";

import { commandInfos } from "./commandsSnapshot";
import { ControlError, toControlError } from "./errors";
import { objectParams, stringParam } from "./params";
import { createUriRunner, type UriDeps, type UriPlan } from "./uriRun";
import { createWindowMethods, type ControlFiles } from "./windowMethods";

import type { CommandRunner } from "../commands/useCommands";
import type { HotkeyOverrides } from "../commands/types";

export { ControlError, type ControlErrorCode } from "./errors";

export interface ControlRequest {
  rid: number;
  method: string;
  params: unknown;
}

export interface ControlDeps {
  listen: (
    event: string,
    cb: (e: { payload: ControlRequest }) => void,
  ) => Promise<() => void>;
  invoke: (
    cmd: string,
    args?: any,
    options?: { headers?: Record<string, string> },
  ) => Promise<unknown>;
  runner: () => Pick<CommandRunner, "run" | "isAvailable" | "platform"> & {
    failedClauses?: (id: string) => string[];
  };
  overrides: () => HotkeyOverrides;
  appState: () => {
    activeDrawing: { path: string; dirty: boolean } | null;
    tabs: number;
  };
  /** Opens the target the way links do; false when it resolves to nothing. */
  openTarget: (target: string, cwd: string) => Promise<boolean>;
  /** Vault, file and tab methods (C3); absent = those methods are not registered. */
  files?: () => ControlFiles;
  /** Window topics wanted when the bridge connected (see windowEvents). */
  onReady?: (topics: string[]) => void;
  /**
   * `vaultdraw://` link effects (see uriRun.ts); `call` is filled in here with
   * this bridge's own handlers. Absent = `uri.run` is not registered.
   */
  uri?: () => Omit<UriDeps, "call">;
}

export function createControlBridge(deps: ControlDeps) {
  const handlers: Record<string, (params: unknown) => unknown> = {
    "app.state": () => deps.appState(),
    "command.list": () => {
      const runner = deps.runner();
      return {
        commands: commandInfos(deps.overrides(), runner.platform).map((c) => ({
          ...c,
          available: runner.isAvailable(c.id),
        })),
      };
    },
    "command.run": (params) => {
      const id = stringParam(params, "id");
      const runner = deps.runner();
      if (!getCommand(id)) {
        throw new ControlError("NOT_FOUND", `Unknown command ${id}`, { id });
      }
      if (!runner.run(id)) {
        throw new ControlError("UNAVAILABLE", `Command ${id} is unavailable`, {
          id,
          failed: runner.failedClauses?.(id) ?? [],
        });
      }
      return { ran: true, id };
    },
    "app.openTarget": async (params) => {
      const target = stringParam(params, "target");
      const cwd = String(objectParams(params).cwd ?? "");
      if (!(await deps.openTarget(target, cwd))) {
        throw new ControlError("NOT_FOUND", `Cannot open ${target}`, {
          target,
        });
      }
      return { opened: true };
    },
    ...(deps.files
      ? createWindowMethods(deps.files, (blob) => spoolBlob(deps.invoke, blob))
      : {}),
  };

  if (deps.uri) {
    const uri = deps.uri;
    // The link runner calls the very handlers the socket uses (file.open, file.create,
    // vault.open, command.run), never a copy of them.
    const runner = createUriRunner(
      new Proxy({} as UriDeps, {
        get: (_, key: string) =>
          key === "call"
            ? async (method: string, params: unknown) => {
                const fn = handlers[method];
                if (!fn) {
                  throw new ControlError("NOT_FOUND", "Unknown window method");
                }
                return fn(params);
              }
            : uri()[key as keyof Omit<UriDeps, "call">],
      }),
    );
    handlers["uri.run"] = (params) =>
      runner.run(objectParams(params) as unknown as UriPlan);
  }

  const reply = (rid: number, body: Record<string, unknown>) =>
    deps.invoke("control_reply", { rid, ...body }).catch(() => {});

  const handle = async ({ rid, method, params }: ControlRequest) => {
    try {
      const fn = handlers[method];
      if (!fn) {
        throw new ControlError("NOT_FOUND", "Unknown window method");
      }
      await reply(rid, { result: await fn(params) });
    } catch (e) {
      const err = toControlError(e);
      await reply(rid, {
        error: { code: err.code, message: err.message, data: err.data },
      });
    }
  };

  return {
    handle,
    /** Registers the one listener, then tells Rust the window is ready. */
    async start(): Promise<() => void> {
      const unlisten = await deps.listen(
        "control-request",
        (e) => void handle(e.payload),
      );
      const ready = (await deps.invoke("control_ready")) as
        | { topics?: string[] }
        | null
        | undefined;
      deps.onReady?.(ready?.topics ?? []);
      return unlisten;
    },
  };
}
