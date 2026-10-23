import { describe, expect, it, vi } from "vitest";

import { runTagRename } from "../tags/renameFlow";
import { FakeVaultTagRename } from "../tests/fakeVaultTagRename";

import { rewriteDoneMessage, toastRewriteDone } from "./rewriteToast";

import type { TagRenameDeps } from "../tags/renameFlow";
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

/**
 * One `links-rewrite-done` channel with two listeners, as in the app: the
 * links wiring (generic toast) and the tag rename flow (its own toast).
 */
function setup() {
  const listeners: ((d: RewriteDone) => void)[] = [];
  const emit = (d: RewriteDone) => listeners.forEach((l) => l(d));
  const notify = vi.fn();
  listeners.push((d) => toastRewriteDone(d, notify));
  const api = new FakeVaultTagRename();
  const deps: TagRenameDeps = {
    api,
    links: {
      onRewriteDone: async (l) => {
        listeners.push(l);
        return () => {
          listeners.splice(listeners.indexOf(l), 1);
        };
      },
    },
    handle: "h",
    openPath: null,
    flush: async () => {},
    applyEdits: () => 0,
    notify,
  };
  return { api, deps, notify, emit };
}

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
    const { api, deps, notify, emit } = setup();
    // The native job is tiny: its done event lands before the invoke reply.
    api.rename = async (handle, from, to, openPath) => {
      api.renameCalls.push({ handle, from, to, openPath });
      emit(done({ jobId: 7 }));
      return {
        jobId: 7,
        plannedFiles: 2,
        plannedLinks: 3,
        openDrawingEdits: [],
      };
    };
    const { completed } = await runTagRename(deps, "dsa", "Algo", "DSA");
    await completed;
    expect(notify.mock.calls).toEqual([
      ["Renamed #DSA to #Algo in 2 drawings", "info"],
    ]);
  });

  it("still toasts a links rewrite that lands while a tag rename is in flight", async () => {
    const { api, deps, notify, emit } = setup();
    api.rename = async (handle, from, to, openPath) => {
      api.renameCalls.push({ handle, from, to, openPath });
      emit(done({ jobId: 5, rewritten: 1, links: 1 }));
      emit(done({ jobId: 7 }));
      return {
        jobId: 7,
        plannedFiles: 2,
        plannedLinks: 3,
        openDrawingEdits: [],
      };
    };
    const { completed } = await runTagRename(deps, "dsa", "Algo", "DSA");
    await completed;
    expect(notify.mock.calls).toEqual([
      ["Updated 1 link in 1 drawing", "info"],
      ["Renamed #DSA to #Algo in 2 drawings", "info"],
    ]);
  });

  it("releases deferred toasts when the rename fails", async () => {
    const { api, deps, notify, emit } = setup();
    api.rename = async () => {
      emit(done({ jobId: 5, rewritten: 1, links: 1 }));
      throw new Error("boom");
    };
    await expect(runTagRename(deps, "dsa", "Algo")).rejects.toThrow("boom");
    expect(notify.mock.calls).toEqual([
      ["Updated 1 link in 1 drawing", "info"],
    ]);
  });
});
