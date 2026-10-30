import { describe, expect, it } from "vitest";

import { nameProblem } from "../../../sdk/api/shared/vaultPaths";
import { validateEntryName } from "../vault/treeStore";

import { FakeVaultRepository } from "./fakeVaultRepository";

/**
 * Hunter E (2026-10-30, quiet): name rules that the dialog, the shared TypeScript rule and the
 * browser stand-in apply differently from the native core (paths.rs, fsops.rs). Rows that fail today
 * are marked `it.fails`: drop `fails` when fixed.
 */
describe("hunter E: name rule twins", () => {
  // E-1: the native core refuses a dot-named entry (fsops.rs reject_hidden), the dialog lets it
  // through and the user only learns after pressing Rename.
  it("E-1 Rename dialog refuses a name starting with a dot, as the core does", () => {
    expect(validateEntryName(".ideas.excalidraw", "drawing").valid).toBe(false);
    expect(validateEntryName(".ideas", "folder").valid).toBe(false);
  });

  // E-2: Rust `char::is_control` covers U+0080..U+009F, the dialog's pattern stops at U+007F.
  it("E-2 Rename dialog refuses C1 control characters, as the core does", () => {
    expect(validateEntryName("a\u0085b.excalidraw", "drawing").valid).toBe(
      false,
    );
    expect(validateEntryName("a\u009fb", "folder").valid).toBe(false);
  });

  // E-3: the Rust message shortens by characters (first 37), the TypeScript one by UTF-16 units,
  // so a long emoji name is cut inside a surrogate pair (a broken character in the message).
  it("E-3 a long emoji name is shortened on a character boundary in the message", () => {
    const name = "\u{1F680}".repeat(70); // 70 characters, 280 bytes: refused as too long
    const msg = nameProblem(name) ?? "";
    // eslint-disable-next-line no-control-regex
    expect(msg).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(msg).toContain(`"${"\u{1F680}".repeat(37)}..."`);
  });

  // E-3b: the core refuses a path over 4096 bytes (paths.rs MAX_REL_PATH_BYTES); the browser
  // stand-in accepts it, so no Playwright test can see that refusal.
  it("E-3b the stand-in refuses a path over 4096 bytes", async () => {
    const repo = new FakeVaultRepository();
    const path = Array.from({ length: 30 }, () => "d".repeat(200)).join("/");
    await expect(repo.createFolder(repo.handle, path)).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
  });
});
