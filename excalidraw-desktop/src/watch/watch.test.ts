import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { normalizeWatchPreferences, WATCH_DEFAULTS } from "./watchSettings";
import { useAutoReload } from "./useAutoReload";

describe("files.auto_reload preference", () => {
  it("defaults on and ignores a bad value", () => {
    expect(WATCH_DEFAULTS.filesAutoReload).toBe(true);
    expect(normalizeWatchPreferences({}).filesAutoReload).toBe(true);
    expect(
      normalizeWatchPreferences({ filesAutoReload: "no" }).filesAutoReload,
    ).toBe(true);
    expect(
      normalizeWatchPreferences({ filesAutoReload: false }).filesAutoReload,
    ).toBe(false);
  });
});

describe("useAutoReload", () => {
  const setup = (enabled: boolean) => {
    const setWatching = vi.fn().mockResolvedValue(undefined);
    const hook = renderHook(
      (p: { h: string | null; on: boolean }) =>
        useAutoReload({ setWatching }, p.h, p.on),
      {
        initialProps: { h: "v1", on: enabled },
      },
    );
    return { setWatching, hook };
  };
  it("sends nothing for an on value at open (the native side read the key)", () => {
    const { setWatching } = setup(true);
    expect(setWatching).not.toHaveBeenCalled();
  });
  it("sends off at open, and each later change once", () => {
    const { setWatching, hook } = setup(false);
    expect(setWatching).toHaveBeenCalledWith("v1", false);
    hook.rerender({ h: "v1", on: false });
    expect(setWatching).toHaveBeenCalledTimes(1);
    hook.rerender({ h: "v1", on: true });
    expect(setWatching).toHaveBeenLastCalledWith("v1", true);
    expect(setWatching).toHaveBeenCalledTimes(2);
  });
});
