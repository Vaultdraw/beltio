import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "../vault/preferences";

import {
  answerBisect,
  startBisect,
  stepsFor,
  type BisectNext,
  type BisectState,
} from "./bisect";
import { bisectCandidates } from "./bisectCommands";
import { parseBisect } from "./bisectState";
import { effectiveExtensions } from "./useExtensions";

const IDS = ["search", "links", "tags", "graph", "library", "my-plugin", "x"];

/** Runs a whole bisect where `culprit` (or nothing) causes the problem. */
function run(candidates: string[], culprit: string | null) {
  let state = startBisect(candidates) as BisectState;
  let restarts = 1;
  for (;;) {
    const problem = culprit !== null && !state.off.includes(culprit);
    const next: BisectNext = answerBisect(state, problem ? "still" : "gone");
    if (next.kind !== "continue") {
      return { next, restarts };
    }
    state = next.state;
    restarts++;
    expect(restarts).toBeLessThan(20);
  }
}

describe("extension bisect", () => {
  it("finds every culprit, in about log2(n) restarts", () => {
    for (const culprit of IDS) {
      const { next, restarts } = run(IDS, culprit);
      expect(next).toEqual({ kind: "found", id: culprit });
      expect(restarts).toBeLessThanOrEqual(stepsFor(IDS.length));
    }
  });

  it("says when the problem is not an extension", () => {
    expect(run(IDS, "not-an-extension-at-all").next).toEqual({ kind: "none" });
    expect(run(["only"], "elsewhere").next).toEqual({ kind: "none" });
    expect(run(["only"], "only").next).toEqual({ kind: "found", id: "only" });
  });

  it("starts with the first half off and refuses an empty set", () => {
    expect(startBisect(["a", "b", "c", "a"])).toEqual({
      candidates: ["a", "b", "c"],
      suspects: ["a", "b", "c"],
      off: ["a", "b"],
      step: 1,
    });
    expect(startBisect([])).toBeNull();
  });

  it("reads only a well-formed stored state", () => {
    const ok = { candidates: ["a"], suspects: ["a"], off: ["a"], step: 1 };
    expect(parseBisect(ok)).toEqual(ok);
    expect(parseBisect({ ...ok, off: "a" })).toBeNull();
    expect(parseBisect(null)).toBeNull();
  });

  it("turns the bisect's off ids off in the effective set", () => {
    const set = effectiveExtensions(DEFAULT_PREFERENCES, false, (id) =>
      ["graph", "links"].includes(id),
    );
    expect(set.graph).toBe(false);
    expect(set.links).toBe(false);
    expect(set.search).toBe(true);
  });

  it("bisects only what runs: plugins installed, compatible, not held back", () => {
    window.localStorage.clear();
    const plugin = (id: string, extra = {}) => ({
      id,
      compatible: true,
      hostDisabled: null,
      review: { state: "ok" },
      ...extra,
    });
    const prefs = JSON.parse(
      window.localStorage.getItem("excalidraw-vault-preferences-v1") ?? "{}",
    );
    window.localStorage.setItem(
      "excalidraw-vault-preferences-v1",
      JSON.stringify({
        ...prefs,
        extGraph: false,
        pluginsEnabled: ["good", "missing", "held", "off", "Bad Id"],
      }),
    );
    const ids = bisectCandidates(window, [
      plugin("good"),
      plugin("held", { review: { state: "review" } }),
      plugin("off", { hostDisabled: "crashed" }),
    ]);
    expect(ids).not.toContain("graph");
    expect(ids).toContain("search");
    expect(ids.filter((id) => !/^[a-z]+$/.test(id) || id === "good")).toEqual([
      "pdf-import",
      "good",
    ]);
    window.localStorage.clear();
  });
});
