import { afterEach, describe, expect, it, vi } from "vitest";

import { failingClauses, whenHolds } from "./context";
import { defineContextKey, readCustomContextKey } from "./contextKeys";

import type { CommandContext, WhenClause } from "./types";

const ctx: CommandContext = {
  vaultOpen: true,
  drawingOpen: false,
  writable: true,
  textEditing: false,
  canvasFocus: false,
  editorFocus: false,
  modalOpen: false,
  listFocus: false,
  galleryFocus: false,
  graphFocus: false,
};

const disposers: (() => void)[] = [];
const define = (id: string, get: () => boolean) => {
  const d = defineContextKey(id, get);
  disposers.push(d);
  return d;
};

afterEach(() => {
  disposers.splice(0).forEach((d) => d());
  vi.restoreAllMocks();
});

describe("custom context keys", () => {
  it("defines and disposes", () => {
    const dispose = define("demo.flag", () => true);
    expect(whenHolds(["demo.flag"], ctx)).toBe(true);
    expect(whenHolds(["!demo.flag"], ctx)).toBe(false);
    dispose();
    expect(whenHolds(["demo.flag"], ctx)).toBe(false);
    expect(whenHolds(["!demo.flag"], ctx)).toBe(true);
  });

  it("requires a namespaced, non built-in id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    define("plain", () => true);
    define("vaultOpen", () => false);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(readCustomContextKey("plain")).toBe(false);
  });

  it("refuses a duplicate and keeps the first", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    define("demo.dup", () => true);
    const second = define("demo.dup", () => false);
    expect(warn).toHaveBeenCalledTimes(1);
    second(); // must not remove the first
    expect(readCustomContextKey("demo.dup")).toBe(true);
  });

  it("evaluates lazily: only when a clause names the key", () => {
    const get = vi.fn(() => true);
    define("demo.lazy", get);
    whenHolds(["vaultOpen", "!modalOpen"], ctx);
    expect(get).not.toHaveBeenCalled();
    whenHolds(["vaultOpen", "demo.lazy"], ctx);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("treats a throwing getter as false and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    define("demo.boom", () => {
      throw new Error("x");
    });
    expect(whenHolds(["demo.boom"], ctx)).toBe(false);
    expect(whenHolds(["demo.boom"], ctx)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("failingClauses reports custom clauses too", () => {
    define("demo.no", () => false);
    const clauses: WhenClause[] = ["vaultOpen", "demo.no", "demo.unknown"];
    expect(failingClauses(clauses, ctx)).toEqual(["demo.no", "demo.unknown"]);
  });
});
