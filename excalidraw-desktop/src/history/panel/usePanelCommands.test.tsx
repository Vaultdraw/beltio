import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getRegisteredHandler } from "../../commands/handlerRegistry";
import { HISTORY_COMMAND_IDS as I } from "../historyCommands";

import { usePanelCommands, type PanelActions } from "./usePanelCommands";

const actions = (): PanelActions => ({
  previous: vi.fn(),
  next: vi.fn(),
  restore: vi.fn(),
  restoreReplace: vi.fn(),
  restoreCopy: vi.fn(),
  copySelection: vi.fn(),
  exportExcalidraw: vi.fn(),
  exportImage: vi.fn(),
  backToCurrent: vi.fn(),
});

describe("usePanelCommands: history.backToCurrent", () => {
  it("is bound only while a version is previewed, and runs the action", () => {
    const a = actions();
    const { rerender, unmount } = renderHook(
      ({ hasVersion }: { hasVersion: boolean }) =>
        usePanelCommands(a, { hasVersion, hasSelection: false }),
      { initialProps: { hasVersion: false } },
    );
    expect(getRegisteredHandler(I.backToCurrent)).toBeUndefined();

    rerender({ hasVersion: true });
    getRegisteredHandler(I.backToCurrent)!();
    expect(a.backToCurrent).toHaveBeenCalledTimes(1);

    rerender({ hasVersion: false });
    expect(getRegisteredHandler(I.backToCurrent)).toBeUndefined();
    unmount();
  });
});
