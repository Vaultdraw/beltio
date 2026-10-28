import { act, renderHook } from "@testing-library/react";

import { afterEach, describe, expect, it, vi } from "vitest";

import { toastStore } from "../toasts/toastStore";

import { FakeVaultRepository } from "../tests/fakeVaultRepository";
import { SAMPLE_SCENE } from "../tests/fixtures";

import { LARGE_DRAWING_CHARS, useExplorerExport } from "./useExplorerExport";

const exportDrawingFromVault = vi.fn();
vi.mock("./exportFromFile", () => ({
  exportDrawingFromVault: (input: unknown) => exportDrawingFromVault(input),
}));

const win = window as unknown as Window & typeof globalThis;

const setup = async () => {
  const repository = new FakeVaultRepository();
  repository.seedDrawing("A/Graphs.excalidraw", SAMPLE_SCENE);
  const vault = (await repository.chooseVault())!;
  const flushIfOpen = vi.fn().mockResolvedValue(undefined);
  const setAlert = vi.fn();
  const { result } = renderHook(() =>
    useExplorerExport({
      repository,
      vault,
      win,
      dark: true,
      flushIfOpen,
      setAlert,
    }),
  );
  return { result, flushIfOpen, setAlert, vault };
};

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useExplorerExport", () => {
  it("flushes the drawing first and exports with the remembered options + theme dark", async () => {
    const { result, flushIfOpen, setAlert, vault } = await setup();
    exportDrawingFromVault.mockResolvedValue(true);
    await act(() => result.current("A/Graphs.excalidraw", "png"));
    expect(flushIfOpen).toHaveBeenCalledWith("A/Graphs.excalidraw");
    expect(exportDrawingFromVault).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: vault.handle,
        path: "A/Graphs.excalidraw",
        format: "png",
        options: expect.objectContaining({ dark: true, scale: 1 }),
      }),
    );
    // Fast export: no busy notice, no alert.
    expect(setAlert).not.toHaveBeenCalled();
  });

  it("shows a busy notice for slow exports and clears it", async () => {
    vi.useFakeTimers();
    const { result, setAlert } = await setup();
    let finish!: (v: boolean) => void;
    exportDrawingFromVault.mockReturnValue(
      new Promise<boolean>((resolve) => (finish = resolve)),
    );
    let done!: Promise<void>;
    act(() => {
      done = result.current("A/Graphs.excalidraw", "svg");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(setAlert).toHaveBeenLastCalledWith({
      message: "Exporting Graphs.excalidraw…",
      type: "info",
    });
    // Rendering done: the notice goes before the save dialog opens.
    exportDrawingFromVault.mock.calls[0][0].onRendered();
    expect(setAlert).toHaveBeenLastCalledWith(null);
    // A second request while one runs says so and starts nothing.
    const push = vi.spyOn(toastStore, "push");
    await act(() => result.current("A/Graphs.excalidraw", "png"));
    expect(push).toHaveBeenCalledWith({
      message: "An export is already running",
    });
    push.mockRestore();
    expect(exportDrawingFromVault).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(true);
      await done;
    });
    expect(setAlert).toHaveBeenCalledTimes(2);
  });

  it("shows the notice before rendering a large drawing", async () => {
    const { result, setAlert } = await setup();
    let alertsBeforeRender = -1;
    exportDrawingFromVault.mockImplementation(async (input: any) => {
      await input.beforeRender("x".repeat(LARGE_DRAWING_CHARS + 1));
      alertsBeforeRender = setAlert.mock.calls.length;
      input.onRendered();
      return true;
    });
    await act(() => result.current("A/Graphs.excalidraw", "png"));
    expect(alertsBeforeRender).toBe(1);
    expect(setAlert.mock.calls[0][0]).toMatchObject({ type: "info" });
    expect(setAlert).toHaveBeenLastCalledWith(null);
  });

  it("reports failures as an error alert", async () => {
    const { result, setAlert } = await setup();
    exportDrawingFromVault.mockRejectedValue(
      new Error("Cannot export an empty canvas."),
    );
    await act(() => result.current("A/Graphs.excalidraw", "png"));
    expect(setAlert).toHaveBeenLastCalledWith({
      message:
        "Couldn't export Graphs.excalidraw: Cannot export an empty canvas.",
      type: "error",
    });
  });
});
