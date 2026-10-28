import { describe, expect, it, vi } from "vitest";

import { PROFILE_COMMANDS } from "../commands/profileCommands";
import { profileNameError } from "../vault/profiles";

describe("profile names", () => {
  it("accepts plain names", () => {
    expect(profileNameError("work", [])).toBeNull();
    expect(profileNameError("Work-2_x", ["play"])).toBeNull();
  });
  it("rejects bad names, default, and case-insensitive duplicates", () => {
    for (const bad of ["", "a b", "a/b", "..", "x".repeat(49), "Default"]) {
      expect(profileNameError(bad, [])).toMatch(/Use 1 to 48/);
    }
    expect(profileNameError("WORK", ["work"])).toMatch(/already exists/);
  });
});

describe("profile commands", () => {
  it("are palette commands with no default key", () => {
    expect(PROFILE_COMMANDS.map((c) => c.id)).toEqual([
      "profile.switch",
      "profile.new",
      "profile.duplicate",
      "profile.delete",
      "profile.useForVault",
      "profile.clearForVault",
    ]);
    expect(PROFILE_COMMANDS.every((c) => c.keys.default.length === 0)).toBe(
      true,
    );
  });
});

describe("a vault's profile", () => {
  it("switches to the profile the vault names, once, and ignores unknown ones", async () => {
    vi.resetModules();
    const profileCall = vi.fn(async () => {});
    const push = vi.fn();
    let name: string | null = "work";
    vi.doMock("../vault/settingsSync", () => ({
      getSettingsStatus: () => ({ profile: null, profiles: ["work"] }),
      isConfigFolderActive: () => true,
      nativeCall: async () => name,
      profileCall,
    }));
    vi.doMock("../toasts/toastStore", () => ({ toastStore: { push } }));
    vi.doMock("../vault/vaultSettings", () => ({
      getVaultSettingsSnapshot: () => ({ handle: "h" }),
    }));
    const { applyVaultProfile } = await import("../vault/profiles");
    await applyVaultProfile("h");
    expect(profileCall).toHaveBeenCalledWith("profile_use", { name: "work" });
    name = "gone";
    await applyVaultProfile("h");
    expect(profileCall).toHaveBeenCalledTimes(1);
    expect(push.mock.calls.at(-1)?.[0].message).toMatch(/does not exist/);
    vi.doUnmock("../vault/settingsSync");
  });

  it("returns to the global choice when the next vault names no profile", async () => {
    vi.resetModules();
    const profileCall = vi.fn(async () => {});
    let name: string | null = "work";
    vi.doMock("../vault/settingsSync", () => ({
      getSettingsStatus: () => ({ profile: "mine", profiles: ["work", "mine"] }),
      isConfigFolderActive: () => true,
      nativeCall: async () => name,
      profileCall,
    }));
    vi.doMock("../toasts/toastStore", () => ({ toastStore: { push: vi.fn() } }));
    vi.doMock("../vault/vaultSettings", () => ({
      getVaultSettingsSnapshot: () => ({ handle: "h" }),
    }));
    const { applyVaultProfile } = await import("../vault/profiles");
    await applyVaultProfile("a");
    expect(profileCall).toHaveBeenLastCalledWith("profile_use", { name: "work" });
    name = null;
    await applyVaultProfile("b");
    expect(profileCall).toHaveBeenLastCalledWith("profile_use", { name: "mine" });
    await applyVaultProfile("c");
    expect(profileCall).toHaveBeenCalledTimes(2);
    vi.doUnmock("../vault/settingsSync");
  });
});
