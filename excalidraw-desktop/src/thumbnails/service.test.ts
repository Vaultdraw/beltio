import { describe, expect, it, vi } from "vitest";

import { createFakeThumbnailStore } from "./fakeStore";
import { createJobQueue } from "./queue";
import { failMarkerVersion, pngRenderVersion } from "./render";
import { THUMB_NONE, createThumbnailService } from "./service";

import type { PngResult } from "./render";
import type { ThumbState, VaultChangeLike } from "./service";

const png = (): PngResult => ({
  kind: "png",
  blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
});
const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};

const setup = (
  opts: {
    revs?: Record<string, string>;
    render?: any;
    pending?: number;
    subscribe?: boolean;
  } = {},
) => {
  const revs: Record<string, string> = opts.revs ?? {
    "a.excalidraw": "r-a",
    "b.excalidraw": "r-b",
  };
  const store = createFakeThumbnailStore({
    revisionOf: (_h, p) => revs[p] ?? null,
    pendingLookups: opts.pending,
  });
  const readDrawing = vi.fn(async (p: string) => ({
    json: `{"p":"${p}"}`,
    revision: revs[p],
  }));
  const render = opts.render ?? vi.fn(async () => png());
  let frame: (() => void) | null = null;
  const frames = {
    run: () => {
      const f = frame;
      frame = null;
      f?.();
    },
  };
  let listener: ((e: VaultChangeLike) => void) | null = null;
  const unsub = vi.fn();
  const subscribe = vi.fn(async (l: (e: VaultChangeLike) => void) => {
    listener = l;
    return unsub;
  });
  const service = createThumbnailService({
    store,
    handle: "h",
    readDrawing,
    render,
    queue: createJobQueue({
      input: { start() {}, stop() {}, remaining: () => 0 },
      yieldFn: () => Promise.resolve(),
    }),
    schedule: (fn) => {
      frame = fn;
    },
    subscribe: opts.subscribe === false ? undefined : subscribe,
  });
  const watch = (path: string, priority?: "visible" | "near") => {
    const states: ThumbState[] = [];
    const off = service.watch(path, (s) => states.push(s), { priority });
    return { states, off, last: () => states[states.length - 1] };
  };
  return {
    service,
    store,
    revs,
    readDrawing,
    render,
    frames,
    watch,
    subscribe,
    unsub,
    emit: (e: VaultChangeLike) => listener?.(e),
  };
};

describe("thumbnail service", () => {
  it("batches every watch of a frame into one lookup", async () => {
    const t = setup();
    const a = t.watch("a.excalidraw");
    t.watch("b.excalidraw");
    expect(t.store.calls.lookup).toBe(0);
    expect(a.last().status).toBe("loading");
    t.frames.run();
    await settle();
    expect(t.store.calls.lookup).toBe(1);
    expect(t.store.calls.lookupPaths[0].sort()).toEqual([
      "a.excalidraw",
      "b.excalidraw",
    ]);
  });

  it("miss -> render -> put -> ready with the stored url; second watch is a hit", async () => {
    const t = setup();
    const a = t.watch("a.excalidraw");
    t.frames.run();
    await settle();
    expect(a.last().status).toBe("ready");
    expect(a.last().url).toBeTruthy();
    expect(t.render).toHaveBeenCalledTimes(1);
    expect(t.store.calls.put).toBe(1);
    a.off();
    const again = t.watch("a.excalidraw");
    t.frames.run();
    await settle();
    expect(again.last().status).toBe("ready");
    expect(t.render).toHaveBeenCalledTimes(1);
  });

  it("limits a lookup to 500 paths and continues next frame", async () => {
    const revs: Record<string, string> = {};
    for (let i = 0; i < 520; i++) {
      revs[`d${i}.excalidraw`] = `r${i}`;
    }
    const t = setup({ revs, render: vi.fn(async () => png()) });
    for (const p of Object.keys(revs)) {
      t.watch(p);
    }
    t.frames.run();
    await settle();
    expect(t.store.calls.lookupPaths[0]).toHaveLength(500);
    t.frames.run();
    await settle();
    expect(t.store.calls.lookupPaths[1]).toHaveLength(20);
  });

  it("retries `pending` on the next frame", async () => {
    const t = setup({ pending: 1 });
    const a = t.watch("a.excalidraw");
    t.frames.run();
    await settle();
    expect(a.last().status).toBe("loading");
    t.frames.run();
    await settle();
    expect(t.store.calls.lookup).toBe(2);
    expect(a.last().status).toBe("ready");
  });

  it("uses the revision actually read for put, and shows none for failed renders (marker stored)", async () => {
    const t = setup({
      render: vi.fn(async () => ({ kind: "fail", reason: "too-many" })),
    });
    const a = t.watch("a.excalidraw");
    t.frames.run();
    await settle();
    expect(a.last()).toBe(THUMB_NONE);
    expect(t.store.calls.put).toBe(1);
    // a transient error is not remembered
    const t2 = setup({
      render: vi.fn(async () => ({ kind: "fail", reason: "error" })),
    });
    const b = t2.watch("a.excalidraw");
    t2.frames.run();
    await settle();
    expect(b.last()).toBe(THUMB_NONE);
    expect(t2.store.calls.put).toBe(0);
  });

  it("fail markers carry their own version: old markers retry, cached PNGs stay", async () => {
    const t = setup();
    const v = pngRenderVersion(1); // jsdom devicePixelRatio 1
    expect(failMarkerVersion(1)).not.toBe(v);
    // a.excalidraw: cached PNG; b.excalidraw: a marker from the old cap (PNG version)
    await t.store.put(
      "h",
      "a.excalidraw",
      "r-a",
      new Blob([new Uint8Array([1])], { type: "image/png" }),
      v,
    );
    await t.store.put("h", "b.excalidraw", "r-b", null, v);
    const put = vi.spyOn(t.store, "put");
    t.render.mockResolvedValueOnce({ kind: "fail", reason: "too-many" });
    const a = t.watch("a.excalidraw");
    const b = t.watch("b.excalidraw");
    t.frames.run();
    await settle();
    expect(a.last().status).toBe("ready");
    expect(t.render).toHaveBeenCalledTimes(1); // only b retried
    expect(b.last()).toBe(THUMB_NONE);
    // The new marker is written under the fail version and honoured next time.
    expect(put).toHaveBeenCalledWith(
      "h",
      "b.excalidraw",
      "r-b",
      null,
      failMarkerVersion(1),
    );
    const res = await t.store.lookup(
      "h",
      ["b.excalidraw"],
      v,
      failMarkerVersion(1),
    );
    expect(res.items[0].state).toBe("failed");
  });

  it("revision mismatch: stores under the revision read, not the looked-up one", async () => {
    const t = setup();
    const put = vi.spyOn(t.store, "put");
    t.readDrawing.mockResolvedValueOnce({ json: "{}", revision: "r-newer" });
    t.watch("a.excalidraw");
    t.frames.run();
    await settle();
    expect(put).toHaveBeenCalledWith(
      "h",
      "a.excalidraw",
      "r-newer",
      expect.anything(),
      pngRenderVersion(1), // jsdom devicePixelRatio 1
    );
  });

  it("missing files show none; read errors show none", async () => {
    const t = setup();
    const gone = t.watch("gone.excalidraw");
    t.readDrawing.mockRejectedValueOnce(new Error("io"));
    const a = t.watch("a.excalidraw");
    t.frames.run();
    await settle();
    expect(gone.last()).toBe(THUMB_NONE);
    expect(a.last()).toBe(THUMB_NONE);
  });

  it("unwatching before the frame cancels the lookup and a queued render", async () => {
    const t = setup();
    const a = t.watch("a.excalidraw");
    a.off();
    t.frames.run();
    await settle();
    expect(t.store.calls.lookup).toBe(0);

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const render = vi.fn(async () => {
      await gate;
      return png();
    });
    const t2 = setup({ render });
    t2.watch("a.excalidraw");
    const b = t2.watch("b.excalidraw");
    t2.frames.run();
    await settle(); // a is rendering (blocked), b is queued
    b.off();
    release();
    await settle();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("noteSaved does nothing unless the path is watched", async () => {
    const t = setup();
    t.service.noteSaved("a.excalidraw", "r2");
    t.frames.run();
    await settle();
    expect(t.store.calls.lookup).toBe(0);
    expect(t.render).not.toHaveBeenCalled();

    const a = t.watch("a.excalidraw");
    t.frames.run();
    await settle();
    expect(t.render).toHaveBeenCalledTimes(1);
    const firstUrl = a.last().url;
    // watched: a save re-checks (one coalesced lookup), shows the old image until the new one is ready
    t.revs["a.excalidraw"] = "r-a2";
    t.service.noteSaved("a.excalidraw", "r-a2");
    t.service.noteSaved("a.excalidraw", "r-a2");
    expect(a.last().url).toBe(firstUrl);
    const before = t.store.calls.lookup;
    t.frames.run();
    await settle();
    expect(t.store.calls.lookup).toBe(before + 1);
    expect(t.render).toHaveBeenCalledTimes(2);
    // same revision again: no work
    t.service.noteSaved("a.excalidraw", "r-a2");
    t.frames.run();
    await settle();
    expect(t.store.calls.lookup).toBe(before + 1);
  });

  it("disabled: no lookups, renders or puts; watchers get none; re-enabling refetches", async () => {
    const t = setup();
    t.service.setEnabled(false);
    const a = t.watch("a.excalidraw");
    t.frames.run();
    await settle();
    expect(a.last()).toBe(THUMB_NONE);
    expect(t.store.calls.lookup + t.store.calls.put).toBe(0);
    t.service.setEnabled(true);
    const b = t.watch("b.excalidraw");
    t.frames.run();
    await settle();
    expect(b.last().status).toBe("ready");

    t.service.setEnabled(false);
    expect(b.last()).toBe(THUMB_NONE); // existing watchers go to none
    t.service.setEnabled(true);
    t.frames.run();
    await settle();
    expect(b.last().status).toBe("ready");
  });

  it("invalidate drops entries by prefix; rescan drops everything; only watched ones refresh", async () => {
    const revs = {
      "d/a.excalidraw": "1",
      "d/b.excalidraw": "2",
      "e/c.excalidraw": "3",
    };
    const t = setup({ revs });
    const w = ["d/a.excalidraw", "d/b.excalidraw", "e/c.excalidraw"].map((p) =>
      t.watch(p),
    );
    t.frames.run();
    await settle();
    expect(t.render).toHaveBeenCalledTimes(3);
    const lookups = t.store.calls.lookup;
    t.service.invalidate(["d"]);
    t.frames.run();
    await settle();
    expect(t.store.calls.lookup).toBe(lookups + 1);
    expect(t.store.calls.lookupPaths.at(-1)!.sort()).toEqual([
      "d/a.excalidraw",
      "d/b.excalidraw",
    ]);
    w[0].off();
    t.service.invalidate([""]);
    t.frames.run();
    await settle();
    expect(t.store.calls.lookupPaths.at(-1)!.sort()).toEqual([
      "d/b.excalidraw",
      "e/c.excalidraw",
    ]);
  });

  it("subscribes to repository changes only while something is watched", async () => {
    const t = setup();
    expect(t.subscribe).not.toHaveBeenCalled();
    const a = t.watch("a.excalidraw");
    t.frames.run();
    await settle();
    expect(t.subscribe).toHaveBeenCalledTimes(1);
    const lookups = t.store.calls.lookup;
    t.emit({ handle: "other", paths: ["a.excalidraw"], rescan: false });
    t.emit({ handle: "h", paths: [], rescan: true });
    t.frames.run();
    await settle();
    expect(t.store.calls.lookup).toBe(lookups + 1);
    a.off();
    expect(t.unsub).toHaveBeenCalledTimes(1);
  });

  it("dispose stops everything", async () => {
    const t = setup();
    const a = t.watch("a.excalidraw");
    await settle();
    t.service.dispose();
    t.frames.run();
    await settle();
    expect(t.store.calls.lookup).toBe(0);
    expect(t.unsub).toHaveBeenCalled();
    a.off();
  });

  it("unwatch + re-watch while the render runs: the joined job publishes to the new entry", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const render = vi.fn(async () => {
      await gate;
      return png();
    });
    const t = setup({ render });
    const first = t.watch("a.excalidraw");
    t.frames.run();
    await settle(); // render started, blocked
    first.off(); // entry dropped (nothing watched)
    const second = t.watch("a.excalidraw");
    t.frames.run();
    await settle(); // lookup miss -> joins the started job
    release();
    await settle();
    expect(render).toHaveBeenCalledTimes(1);
    expect(second.last().status).toBe("ready");
  });

  it("passes a cancel check to the render: true once the path is unwatched", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let cancelled: (() => boolean) | undefined;
    const render = vi.fn(async (_j: string, _d?: number, c?: () => boolean) => {
      cancelled = c;
      await gate;
      return c?.()
        ? ({ kind: "fail", reason: "cancelled" } as PngResult)
        : png();
    });
    const t = setup({ render });
    const a = t.watch("a.excalidraw");
    t.frames.run();
    await settle();
    expect(cancelled?.()).toBe(false);
    a.off();
    expect(cancelled?.()).toBe(true);
    release();
    await settle();
    expect(t.store.calls.put).toBe(0); // no fail marker for a cancelled render
  });

  it("a render cancelled while unwatched, joined by a re-watch, is looked up again", async () => {
    let releasePoll!: () => void;
    const poll = new Promise<void>((r) => (releasePoll = r));
    let releaseEnd!: () => void;
    const end = new Promise<void>((r) => (releaseEnd = r));
    let calls = 0;
    const render = vi.fn(async (_j: string, _d?: number, c?: () => boolean) => {
      if (++calls > 1) {
        return png();
      }
      await poll;
      const stop = c?.() ?? false;
      await end;
      return stop
        ? ({ kind: "fail", reason: "cancelled" } as PngResult)
        : png();
    });
    const t = setup({ render });
    const first = t.watch("a.excalidraw");
    t.frames.run();
    await settle(); // render started
    first.off();
    releasePoll();
    await settle(); // the render saw "cancelled"
    const second = t.watch("a.excalidraw");
    t.frames.run();
    await settle(); // lookup miss -> joins the started (cancelled) job
    releaseEnd();
    await settle();
    t.frames.run();
    await settle();
    expect(render).toHaveBeenCalledTimes(2);
    expect(second.last().status).toBe("ready");
  });

  it("a hung render times out as a failure without a fail marker and frees the queue", async () => {
    const render = vi.fn(() => new Promise<PngResult>(() => {}));
    const store = createFakeThumbnailStore({ revisionOf: () => "r" });
    let frame: (() => void) | null = null;
    const service = createThumbnailService({
      store,
      handle: "h",
      readDrawing: async () => ({ json: "{}", revision: "r" }),
      render,
      queue: createJobQueue({
        input: { start() {}, stop() {}, remaining: () => 0 },
        yieldFn: () => Promise.resolve(),
        jobTimeoutMs: 30,
      }),
      schedule: (fn) => {
        frame = fn;
      },
    });
    const states: ThumbState[] = [];
    service.watch("a.excalidraw", (s) => states.push(s));
    (frame as any)?.();
    await new Promise((r) => setTimeout(r, 80));
    expect(states[states.length - 1]).toBe(THUMB_NONE);
    expect(store.calls.put).toBe(0);
  });

  it("refresh re-checks one watched path", async () => {
    const t = setup();
    const a = t.watch("a.excalidraw");
    t.frames.run();
    await settle();
    t.service.refresh("a.excalidraw");
    t.frames.run();
    await settle();
    expect(t.store.calls.lookup).toBe(2);
    expect(a.last().status).toBe("ready");
  });
});
