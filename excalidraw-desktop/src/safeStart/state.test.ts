import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getSafeStart,
  isCoreSafeStart,
  safeStartReasonText,
  setSafeStart,
  subscribeSafeStart,
} from "./state";

import type { SafeStart } from "./state";

const core: SafeStart = {
  reason: "flag",
  scope: "core",
  crashedLaunches: 0,
  pluginsAtCrash: [],
};

afterEach(() => setSafeStart(null));

describe("safe start state", () => {
  it("starts empty and is not core", () => {
    expect(getSafeStart()).toBeNull();
    expect(isCoreSafeStart()).toBe(false);
  });

  it("tells core from plugins scope", () => {
    setSafeStart(core);
    expect(isCoreSafeStart()).toBe(true);
    setSafeStart({ ...core, scope: "plugins", reason: "crashes" });
    expect(isCoreSafeStart()).toBe(false);
    expect(getSafeStart()?.scope).toBe("plugins");
  });

  it("notifies on a change, not on the same value, and stops after unsubscribe", () => {
    const cb = vi.fn();
    const off = subscribeSafeStart(cb);
    setSafeStart(core);
    setSafeStart({ ...core });
    expect(cb).toHaveBeenCalledTimes(1);
    setSafeStart(null);
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    setSafeStart(core);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("explains every reason in words", () => {
    const text = (reason: SafeStart["reason"], n = 0) =>
      safeStartReasonText({ ...core, reason, crashedLaunches: n });
    expect(text("flag")).toBe("started with --safe");
    expect(text("env")).toBe("VAULTDRAW_SAFE is set");
    expect(text("crashes", 2)).toBe("after 2 crashed launches");
    expect(text("modifier")).toBe("Option was held");
    expect(text("user")).toBe("you asked for it");
  });
});
