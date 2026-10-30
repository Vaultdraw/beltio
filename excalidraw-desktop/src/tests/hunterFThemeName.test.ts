import { describe, expect, it } from "vitest";

import { validateCandidate } from "../theme/install/installer";

/**
 * Hunter F (2026-10-30). Look up's name pre-check (validateCandidate -> validateEntryName "folder")
 * is a twin of the native `sanitize_name` in src-tauri/src/theme_install.rs, and they drifted:
 *  - native: 80 characters at most, TS: 255 bytes
 *  - native: the name "source" is reserved, TS lets it through
 *  - TS: a trailing dot is refused with "Folder names cannot end with a dot" (a theme is not a
 *    folder; native allows it)
 * The user then presses Install and meets a different refusal, which is what toimprove 158 meant to avoid.
 */
const colours =
  '"dark":{"mPrimary":"#123456","mSurface":"#101010","mOnSurface":"#eee"}';
const file = (name: string) => `{"name":${JSON.stringify(name)},${colours}}`;
const refused = (name: string) => {
  try {
    validateCandidate(file(name), "x");
  } catch {
    return true;
  }
  return false;
};

describe("hunter F-1: Look up pre-check agrees with the native theme name rules", () => {
  it("a name over 80 characters is refused at Look up (native refuses it)", () => {
    expect(refused("A".repeat(100))).toBe(true);
  });
  it("the reserved name Source is refused at Look up (native refuses it)", () => {
    expect(refused("Source")).toBe(true);
    expect(refused("source")).toBe(true);
  });
});

describe("hunter F-2: Look up wording names a folder for a theme", () => {
  it("a theme name ending in a dot does not say 'Folder'", () => {
    let message = "";
    try {
      validateCandidate(file("Dracula."), "x");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toMatch(/folder/i);
  });
});
