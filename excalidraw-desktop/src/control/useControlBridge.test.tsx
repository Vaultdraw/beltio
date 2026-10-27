import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runHandler } from "../commands/dispatcher";
import { getRegisteredHandler } from "../commands/handlerRegistry";
import { toastStore } from "../toasts/toastStore";

import {
  CLI_INSTALL_ID,
  CLI_INSTALL_SYSTEM_ID,
  useControlBridge,
} from "./useControlBridge";

const invoke = vi.fn();
const unlisten = vi.fn();
let onRequest: ((e: { payload: unknown }) => void) | null = null;
let onTopics: ((e: { payload: unknown }) => void) | null = null;
const listen = vi.fn(async (event: string, cb: typeof onRequest) => {
  if (event === "control-topics") {
    onTopics = cb;
  } else {
    onRequest = cb;
  }
  return unlisten;
});
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

const deps = () => ({
  runner: () =>
    ({
      run: () => true,
      isAvailable: () => true,
      platform: "mac",
    } as any),
  appState: () => ({ activeDrawing: null, tabs: 0 }),
  openTarget: async () => true,
});

const tauriWin = () => {
  const win = Object.create(window) as Window & Record<string, unknown>;
  win.__TAURI_INTERNALS__ = {};
  win.requestIdleCallback = (cb: IdleRequestCallback) => {
    cb({} as IdleDeadline);
    return 1;
  };
  return win;
};

const calls = (name: string) => invoke.mock.calls.filter((c) => c[0] === name);

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
  listen.mockClear();
  unlisten.mockClear();
  onRequest = null;
  toastStore.clear();
});
afterEach(() => vi.useRealTimers());

describe("useControlBridge", () => {
  it("is a no-op outside Tauri, but still registers the install commands", async () => {
    const { unmount } = renderHook(() => useControlBridge(window, deps()));
    await new Promise((r) => setTimeout(r, 20));
    expect(listen).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(getRegisteredHandler(CLI_INSTALL_ID)).toBeDefined();
    expect(getRegisteredHandler(CLI_INSTALL_SYSTEM_ID)).toBeDefined();
    unmount();
    expect(getRegisteredHandler(CLI_INSTALL_ID)).toBeUndefined();
  });

  it("e2e harness sink receives the scene methods, loaded lazily", async () => {
    vi.stubEnv("VITE_APP_E2E", "true");
    try {
      const sink = vi.fn();
      const win = Object.create(window) as Window & Record<string, unknown>;
      win.__controlMethodsSink = sink;
      renderHook(() => useControlBridge(win, deps()));
      await waitFor(() => expect(sink).toHaveBeenCalledTimes(1));
      const methods = sink.mock.calls[0][0] as Record<string, unknown>;
      for (const name of [
        "scene.read",
        "scene.get",
        "scene.selection",
        "scene.apply",
        "scene.onFile",
      ]) {
        expect(typeof methods[name]).toBe("function");
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("listens once, signals ready, sends the snapshot on idle and answers requests", async () => {
    const { unmount } = renderHook(() => useControlBridge(tauriWin(), deps()));
    await waitFor(() =>
      expect(calls("control_commands_snapshot")).toHaveLength(1),
    );
    expect(listen.mock.calls.map((c) => c[0])).toEqual([
      "control-request",
      "control-topics",
    ]);
    expect(calls("control_ready")).toHaveLength(1);
    const { commands } = calls("control_commands_snapshot")[0][1];
    expect(commands.some((c: { id: string }) => c.id === CLI_INSTALL_ID)).toBe(
      true,
    );

    onRequest!({ payload: { rid: 3, method: "app.state", params: {} } });
    await waitFor(() =>
      expect(calls("control_reply")[0][1]).toEqual({
        rid: 3,
        result: { activeDrawing: null, tabs: 0 },
      }),
    );

    unmount();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it("topics: nothing published until wanted; ready result and control-topics drive it", async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === "control_ready" ? { topics: ["command"] } : undefined,
    );
    const { unmount } = renderHook(() => useControlBridge(tauriWin(), deps()));
    await waitFor(() => expect(calls("control_ready")).toHaveLength(1));
    await waitFor(() => expect(onTopics).not.toBeNull());
    await new Promise((r) => setTimeout(r, 10));
    runHandler("t.one", () => {});
    expect(calls("control_event")).toEqual([
      [
        "control_event",
        { topic: "command", name: "command.ran", data: { id: "t.one" } },
      ],
    ]);
    onTopics!({ payload: { topics: [] } });
    runHandler("t.two", () => {});
    expect(calls("control_event")).toHaveLength(1);
    unmount();
    onTopics = null;
  });

  it("unmount before the bridge starts never leaves a listener", async () => {
    const { unmount } = renderHook(() => useControlBridge(tauriWin(), deps()));
    unmount();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls("control_ready")).toHaveLength(0);
    expect(unlisten.mock.calls.length).toBe(listen.mock.calls.length);
  });

  it("install commands toast the path, or the error", async () => {
    const { unmount } = renderHook(() => useControlBridge(window, deps()));
    invoke.mockResolvedValueOnce({ path: "/Users/me/.local/bin/vaultdraw" });
    await getRegisteredHandler(CLI_INSTALL_ID)!();
    expect(invoke).toHaveBeenCalledWith("control_install_cli", {
      system: false,
    });
    expect(toastStore.getSnapshot().toasts.at(-1)).toMatchObject({
      message:
        "Installed 'vaultdraw' command at /Users/me/.local/bin/vaultdraw",
    });

    // Linux AppImage: Rust sends its own line (the command is a copy); the toast shows it.
    invoke.mockResolvedValueOnce({
      path: "/home/me/.local/bin/vaultdraw",
      message:
        "Installed 'vaultdraw' command at /home/me/.local/bin/vaultdraw as a copy",
    });
    await getRegisteredHandler(CLI_INSTALL_ID)!();
    expect(toastStore.getSnapshot().toasts.at(-1)).toMatchObject({
      message:
        "Installed 'vaultdraw' command at /home/me/.local/bin/vaultdraw as a copy",
    });

    invoke.mockRejectedValueOnce(new Error("Permission denied"));
    await getRegisteredHandler(CLI_INSTALL_SYSTEM_ID)!();
    expect(invoke).toHaveBeenLastCalledWith("control_install_cli", {
      system: true,
    });
    expect(toastStore.getSnapshot().toasts.at(-1)).toMatchObject({
      message: "Permission denied",
      kind: "error",
    });
    unmount();
  });
});
