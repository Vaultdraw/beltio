import { describe, expect, it } from "vitest";

import { isNonSettingsBatch } from "./configPaths";

const root = "/home/u/.config/vaultdraw";

describe("isNonSettingsBatch", () => {
  it("is true only when every path is in a folder no settings layer reads", () => {
    expect(isNonSettingsBatch([`${root}/plugins/x/main.js`], root)).toBe(true);
    expect(isNonSettingsBatch([`${root}/themes/a.toml`], root)).toBe(true);
    expect(isNonSettingsBatch([`${root}/snippets/a.css`], root)).toBe(true);
    expect(isNonSettingsBatch([`${root}/.git/HEAD`], root)).toBe(true);
  });

  it("is false for settings files, includes, outside paths and unknown input", () => {
    expect(isNonSettingsBatch([`${root}/config.toml`], root)).toBe(false);
    expect(isNonSettingsBatch([`${root}/overrides.toml`], root)).toBe(false);
    expect(isNonSettingsBatch([`${root}/profiles/work.toml`], root)).toBe(
      false,
    );
    expect(
      isNonSettingsBatch([`${root}/plugins/a`, `${root}/keys.toml`], root),
    ).toBe(false);
    expect(isNonSettingsBatch(["/elsewhere/inc.toml"], root)).toBe(false);
    expect(isNonSettingsBatch([root], root)).toBe(false);
    expect(isNonSettingsBatch([], root)).toBe(false);
    expect(isNonSettingsBatch(undefined, root)).toBe(false);
    expect(isNonSettingsBatch([`${root}/plugins/a`], null)).toBe(false);
  });
});
