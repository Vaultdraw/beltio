import { describe, expect, it } from "vitest";

import { userError, userErrorDetail } from "./userError";

const coded = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

describe("userError", () => {
  it.each([
    // [thrown, fallback, shown]
    [
      coded("NAME_COLLISION", "A file named “a” already exists here"),
      undefined,
      "A file named “a” already exists here",
    ],
    [coded("NOT_FOUND", "ENOENT /x/y"), undefined, /no longer there/],
    [coded("READ_ONLY", "ro"), undefined, /read-only/],
    [new Error("Permission denied (os error 13)"), undefined, /isn't allowed/],
    [new Error("No space left on device"), undefined, "The disk is full."],
    [
      new TypeError("Cannot read properties of undefined"),
      "Couldn't rename.",
      "Couldn't rename.",
    ],
    [
      new Error('invoke failed: {"code":"X"}'),
      undefined,
      "Something went wrong.",
    ],
    [
      new Error("Error: boom\n    at foo (a.js:1:2)"),
      undefined,
      "Something went wrong.",
    ],
    [
      "The link target is outside the vault.",
      undefined,
      "The link target is outside the vault.",
    ],
    [
      coded("WEIRD_CODE", "internal detail"),
      "Couldn't move it.",
      "Couldn't move it.",
    ],
  ])("%s → plain words", (thrown, fallback, shown) => {
    const text = userError(thrown, fallback);
    if (shown instanceof RegExp) {
      expect(text).toMatch(shown);
    } else {
      expect(text).toBe(shown);
    }
    expect(text).not.toMatch(
      /os error|ENOENT|TypeError|undefined|\bat \S+:\d+/,
    );
  });

  it("keeps the raw detail for reports", () => {
    expect(userErrorDetail(new Error("os error 13"))).toBe("os error 13");
  });
});
