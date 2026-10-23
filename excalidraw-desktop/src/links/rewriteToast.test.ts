import { afterEach, describe, expect, it, vi } from "vitest";

import { runTagRename } from "../tags/renameFlow";
import {
  beginTagRename,
  claimTagJob,
  GATE_TIMEOUT_MS,
  isTagJob,
  releaseTagJob,
} from "../tags/renameJobs";
import { FakeVaultTagRename } from "../tests/fakeVaultTagRename";

import { rewriteDoneMessage, toastRewriteDone } from "./rewriteToast";

import type { TagRenameDeps } from "../tags/renameFlow";
import type { MoveResult } from "./types";
import type { RewriteDone } from "./types";

const done = (over: Partial<RewriteDone> = {}): RewriteDone => ({
  handle: "h",
  jobId: 7,
  rewritten: 2,
  links: 3,
  failed: [],
  tookMs: 1,
  ...over,
});

const job7: MoveResult = {
  jobId: 7,
  plannedFiles: 2,
  plannedLinks: 3,
  openDrawingEdits: [],
};

const macrotask = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * One `links-rewrite-done` channel with two listeners, as in the app: the
 * links wiring (generic toast) and the tag rename flow (its own toast). Like
 * Tauri's `listen`, the tag flow's registration completes a macrotask later
 * (`asyncListen`), so an un-awaited registration misses early events.
 */
function setup({ asyncListen = true, vault = "h" } = {}) {
  const listeners: ((d: RewriteDone) => void)[] = [];
  const emit = (d: RewriteDone) => [...listeners].forEach((l) => l(d));
  const notify = vi.fn();
  const current = { vault };
  listeners.push((d) =>
    toastRewriteDone(
      d,
      () => notify,
      () => current.vault,
    ),
  );
  const api = new FakeVaultTagRename();
  const deps: TagRenameDeps = {
    api,
    links: {
      onRewriteDone: async (l) => {
        if (asyncListen) {
          await macrotask();
        }
        listeners.push(l);
        return () => {
          const i = listeners.indexOf(l);
          if (i >= 0) {
            listeners.splice(i, 1);
          }
        };
      },
    },
    handle: "h",
    openPath: null,
    flush: async () => {},
    applyEdits: () => 0,
    notify,
  };
  /** rename() that emits `events` before it resolves with `result`. */
  const renameEmitting = (events: RewriteDone[], result = job7) => {
    api.rename = async (handle, from, to, openPath) => {
      api.renameCalls.push({ handle, from, to, openPath });
      events.forEach(emit);
      return result;
    };
  };
  return { api, deps, notify, emit, listeners, current, renameEmitting };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("rewriteDoneMessage", () => {
  it("says how many links were updated", () => {
    expect(rewriteDoneMessage(done())).toEqual({
      message: "Updated 3 links in 2 drawings",
      type: "info",
    });
  });
  it("names skipped files as an error", () => {
    expect(
      rewriteDoneMessage(
        done({
          rewritten: 1,
          failed: [{ path: "a.excalidraw", code: "CONFLICT", message: "" }],
        }),
      ),
    ).toEqual({
      message:
        "Updated 3 links in 1 drawing; skipped: a.excalidraw (changed on disk)",
      type: "error",
    });
  });
  it("stays quiet when nothing was rewritten", () => {
    expect(rewriteDoneMessage(done({ rewritten: 0 }))).toBeNull();
  });
});

describe("toastRewriteDone vs a tag rename", () => {
  it("toasts a links rewrite when no tag rename is running", () => {
    const { notify, emit } = setup();
    emit(done({ jobId: 3 }));
    expect(notify).toHaveBeenCalledWith(
      "Updated 3 links in 2 drawings",
      "info",
    );
  });

  it("does not toast 'Updated N links' when the tag job finishes before rename() resolves", async () => {
    const { deps, notify, renameEmitting } = setup();
    renameEmitting([done({ jobId: 7 })]);
    const { completed } = await runTagRename(deps, "dsa", "Algo", "DSA");
    await completed;
    expect(notify.mock.calls).toEqual([
      ["Renamed #DSA to #Algo in 2 drawings", "info"],
    ]);
  });

  it("waits for the async listener registration before invoking (fast job still reported)", async () => {
    const { deps, notify, renameEmitting, listeners } = setup({
      asyncListen: true,
    });
    renameEmitting([done({ jobId: 7 })]);
    const { completed } = await runTagRename(deps, "dsa", "Algo", "DSA");
    await completed; // would hang if the early event were missed
    expect(notify.mock.calls).toEqual([
      ["Renamed #DSA to #Algo in 2 drawings", "info"],
    ]);
    expect(listeners).toHaveLength(1); // the flow unsubscribed
    expect(isTagJob("h", 7)).toBe(false);
  });

  it("still toasts a links rewrite that lands while a tag rename is in flight", async () => {
    const { deps, notify, renameEmitting } = setup();
    renameEmitting([done({ jobId: 5, rewritten: 1, links: 1 }), done()]);
    const { completed } = await runTagRename(deps, "dsa", "Algo", "DSA");
    await completed;
    expect(notify.mock.calls).toEqual([
      ["Updated 1 link in 1 drawing", "info"],
      ["Renamed #DSA to #Algo in 2 drawings", "info"],
    ]);
  });

  it("releases deferred toasts when the rename fails", async () => {
    const { api, deps, notify, emit, listeners } = setup();
    api.rename = async () => {
      emit(done({ jobId: 5, rewritten: 1, links: 1 }));
      throw new Error("boom");
    };
    await expect(runTagRename(deps, "dsa", "Algo")).rejects.toThrow("boom");
    expect(notify.mock.calls).toEqual([
      ["Updated 1 link in 1 drawing", "info"],
    ]);
    expect(listeners).toHaveLength(1);
  });

  it("falls back to the generic toast when applying the open drawing's edits throws", async () => {
    const { deps, notify, emit, renameEmitting, listeners } = setup();
    renameEmitting([], {
      ...job7,
      openDrawingEdits: [{ elementId: "t", field: "text", value: "#Algo" }],
    });
    deps.applyEdits = () => {
      throw new Error("editor gone");
    };
    await expect(runTagRename(deps, "dsa", "Algo")).rejects.toThrow(
      "editor gone",
    );
    expect(isTagJob("h", 7)).toBe(false); // never left claimed
    expect(listeners).toHaveLength(1); // the flow's listener is gone
    emit(done());
    expect(notify.mock.calls).toEqual([
      ["Updated 3 links in 2 drawings", "info"],
    ]);
  });

  it("an early event is reported by the generic toast when applying edits throws", async () => {
    const { deps, notify, renameEmitting } = setup();
    renameEmitting([done()], {
      ...job7,
      openDrawingEdits: [{ elementId: "t", field: "text", value: "#Algo" }],
    });
    deps.applyEdits = () => {
      throw new Error("editor gone");
    };
    await expect(runTagRename(deps, "dsa", "Algo")).rejects.toThrow();
    expect(notify.mock.calls).toEqual([
      ["Updated 3 links in 2 drawings", "info"],
    ]);
  });

  it("keys tag jobs by vault: the same job id in another vault still toasts", async () => {
    const { notify, emit } = setup({ vault: "other" });
    claimTagJob("h", 7);
    try {
      emit(done({ handle: "other", jobId: 7 }));
    } finally {
      releaseTagJob("h", 7);
    }
    expect(notify).toHaveBeenCalledWith(
      "Updated 3 links in 2 drawings",
      "info",
    );
  });

  it("a hung tag rename holds an unrelated toast for at most GATE_TIMEOUT_MS", () => {
    vi.useFakeTimers();
    const { notify, emit } = setup();
    const close = beginTagRename();
    emit(done({ jobId: 5 }));
    vi.advanceTimersByTime(GATE_TIMEOUT_MS - 1);
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(notify).toHaveBeenCalledTimes(1);
    close(); // closing later does not toast twice
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("a deferred toast for a vault that is no longer open stays silent", () => {
    const { notify, emit, current } = setup();
    const close = beginTagRename();
    emit(done({ jobId: 5 }));
    current.vault = "next";
    close();
    expect(notify).not.toHaveBeenCalled();
  });
});
