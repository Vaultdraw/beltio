import { describe, expect, it } from "vitest";

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
    ]);
    expect(PROFILE_COMMANDS.every((c) => c.keys.default.length === 0)).toBe(
      true,
    );
  });
});
