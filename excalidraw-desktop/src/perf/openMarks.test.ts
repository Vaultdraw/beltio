import { describe, expect, it } from "vitest";

import { markOpen, readOpenMarks } from "./openMarks";

describe("open marks", () => {
  it("reads the current open's steps relative to its start, and a new open replaces them", () => {
    const t0 = performance.now();
    markOpen("read");
    markOpen("read-done");
    markOpen("landed");
    const first = readOpenMarks(t0);
    expect(Object.keys(first)).toEqual(["read", "read-done", "landed"]);
    expect(first.landed).toBeGreaterThanOrEqual(first.read);

    markOpen("read");
    const second = readOpenMarks(t0);
    expect(Object.keys(second)).toEqual(["read"]);
    expect(
      performance
        .getEntriesByType("mark")
        .filter((m) => m.name.startsWith("vaultdraw:open:")),
    ).toHaveLength(1);
  });
});
