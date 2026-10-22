import { describe, expect, it } from "vitest";

import { toAsciiJson } from "./asciiJson";

describe("toAsciiJson", () => {
  it("returns ASCII text unchanged (same string)", () => {
    const text = '{"a":"plain \\u00e9"}';
    expect(toAsciiJson(text)).toBe(text);
  });

  it("escapes every non-ASCII UTF-16 unit with lowercase hex, same JSON value", () => {
    const value = { t: "a — b é ✓ 😀 \u2028", n: ["ü"] };
    const text = JSON.stringify(value, null, 2);
    const out = toAsciiJson(text);
    expect(out).toContain("\\u2014");
    expect(out).toContain("\\u00e9");
    expect(out).toContain("\\ud83d\\ude00");
    expect(out).toContain("\\u2028");
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7f]*$/.test(out)).toBe(true);
    expect(JSON.parse(out)).toEqual(value);
  });

  it("leaves escaped backslashes and existing escapes alone", () => {
    const text = JSON.stringify({ t: "\\u2014 literal, — real, \u0001" });
    expect(JSON.parse(toAsciiJson(text))).toEqual(JSON.parse(text));
  });
});
