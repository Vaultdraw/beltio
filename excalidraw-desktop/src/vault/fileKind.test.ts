import { describe, expect, it } from "vitest";

import raw from "./fixtures/filekind.json";
import {
  fileKind,
  hasHiddenComponent,
  isHiddenName,
  stripDrawingExt,
} from "./fileKind";

const fixtures = raw as {
  kinds: [string, string][];
  hidden: [string, boolean][];
  strip: [string, string][];
};

describe("fileKind (shared fixtures with Rust)", () => {
  it.each(fixtures.kinds)("%s is %s", (name, kind) => {
    expect(fileKind(name)).toBe(kind);
  });
  it.each(fixtures.hidden)("isHiddenName(%s) is %s", (name, hidden) => {
    expect(isHiddenName(name)).toBe(hidden);
  });
  it.each(fixtures.strip)("stripDrawingExt(%s) is %s", (name, out) => {
    expect(stripDrawingExt(name)).toBe(out);
  });
  it("finds hidden path components", () => {
    expect(hasHiddenComponent("a/.trash/b.md")).toBe(true);
    expect(hasHiddenComponent("a/b.md")).toBe(false);
  });
});
