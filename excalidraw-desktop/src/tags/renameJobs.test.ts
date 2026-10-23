import { describe, expect, it, vi } from "vitest";

import { beginTagRename, whenTagJobsKnown } from "./renameJobs";

describe("whenTagJobsKnown", () => {
  it("runs at once when no rename is in flight", () => {
    const fn = vi.fn();
    whenTagJobsKnown(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("waits for every open gate", () => {
    const fn = vi.fn();
    const a = beginTagRename();
    const b = beginTagRename();
    whenTagJobsKnown(fn);
    a();
    a(); // idempotent
    expect(fn).not.toHaveBeenCalled();
    b();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("isolates callbacks: one throw neither drops the rest nor reaches the closer", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const after = vi.fn();
    const close = beginTagRename();
    whenTagJobsKnown(() => {
      throw new Error("bad toast");
    });
    whenTagJobsKnown(after);
    expect(() => close()).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("a throwing immediate callback does not throw to the caller", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      whenTagJobsKnown(() => {
        throw new Error("bad toast");
      }),
    ).not.toThrow();
    error.mockRestore();
  });
});
