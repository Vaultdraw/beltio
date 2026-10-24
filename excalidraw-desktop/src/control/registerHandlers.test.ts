import { describe, expect, it, vi } from "vitest";

import { registerHandlers } from "./registerHandlers";

import type { AskSpec } from "./uriRun";

const make = (
  plan: unknown,
  apply: unknown = { written: [], skipped: [], notes: [] },
) => {
  const calls: string[] = [];
  const asks: AskSpec[] = [];
  const notes: [string, string | undefined][] = [];
  const invoke = vi.fn(async (c: string) => {
    calls.push(c);
    if (c === "links_handlers_plan") {
      if (plan instanceof Error) {
        throw plan;
      }
      return plan;
    }
    return apply;
  });
  return {
    calls,
    asks,
    notes,
    run: () =>
      registerHandlers({
        invoke,
        ask: (s) => asks.push(s),
        notify: (m, k) => notes.push([m, k]),
      }),
  };
};

const fresh = {
  files: [
    { path: "/h/.local/share/applications/vaultdraw.desktop", state: "new" },
    { path: "/h/.local/share/mime/packages/vaultdraw.xml", state: "new" },
  ],
  commands: ["update-desktop-database /h/.local/share/applications"],
};

describe("registerHandlers", () => {
  it("security: asks first, listing every file and program, and writes nothing unanswered", async () => {
    const t = make(fresh);
    await t.run();
    expect(t.calls).toEqual(["links_handlers_plan"]);
    expect(t.asks).toHaveLength(1);
    expect(t.asks[0].details).toEqual([
      "create: /h/.local/share/applications/vaultdraw.desktop",
      "create: /h/.local/share/mime/packages/vaultdraw.xml",
      "then run: update-desktop-database /h/.local/share/applications",
    ]);
    expect(t.notes).toEqual([]);
  });

  it("applies only after the user confirms, then says so", async () => {
    const t = make(fresh);
    await t.run();
    t.asks[0].onConfirm();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.calls).toEqual(["links_handlers_plan", "links_handlers_apply"]);
    expect(t.notes[0][0]).toMatch(/registered/);
  });

  it("an error from the plan is shown and nothing is asked", async () => {
    const t = make(new Error("for Linux"));
    await t.run();
    expect(t.asks).toEqual([]);
    expect(t.notes).toEqual([["for Linux", "error"]]);
  });

  it("already registered, or only foreign files: says so, asks nothing", async () => {
    const same = make({ files: [{ path: "/a", state: "same" }], commands: [] });
    await same.run();
    expect(same.asks).toEqual([]);
    expect(same.notes[0][0]).toMatch(/already registered/);
    const foreign = make({
      files: [{ path: "/a", state: "foreign" }],
      commands: [],
    });
    await foreign.run();
    expect(foreign.asks).toEqual([]);
    expect(foreign.notes[0][0]).toMatch(/not created by Vaultdraw/);
  });

  it("a failed helper program is reported, not hidden", async () => {
    const t = make(fresh, {
      written: ["/a"],
      skipped: [],
      notes: ["xdg-mime: not found"],
    });
    await t.run();
    t.asks[0].onConfirm();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.notes[0][0]).toContain("xdg-mime: not found");
  });
});
