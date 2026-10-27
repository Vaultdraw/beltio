/**
 * Background-scan progress coalescing: N directories produce a few state
 * updates, the final list is exact, and an aborted/cancelled scan emits nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProgressThrottle,
  scanVaultMetadata,
  SCAN_PROGRESS_INTERVAL_MS,
} from "../vault/treeStore";

import { FakeVaultRepository } from "./fakeVaultRepository";
import { BLANK_SCENE } from "./fixtures";

import type { VaultEntry } from "../vault/types";

const entry = (path: string): VaultEntry => ({
  path,
  name: path.split("/").pop()!,
  kind: "drawing",
  modifiedAt: 0,
  size: 0,
});

describe("createProgressThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits one snapshot per interval, not one per push", () => {
    const emit = vi.fn();
    const throttle = createProgressThrottle(emit);
    const all: VaultEntry[] = [];
    for (let i = 0; i < 141; i++) {
      all.push(entry(`d${i}.excalidraw`));
      throttle.push(all);
    }
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SCAN_PROGRESS_INTERVAL_MS);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toHaveLength(141);
    // The snapshot is a copy: later growth of the scan list does not leak in.
    all.push(entry("late.excalidraw"));
    expect(emit.mock.calls[0][0]).toHaveLength(141);
    throttle.push(all);
    vi.advanceTimersByTime(SCAN_PROGRESS_INTERVAL_MS);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1][0]).toHaveLength(142);
  });

  it("cancel drops the pending emit", () => {
    const emit = vi.fn();
    const throttle = createProgressThrottle(emit);
    throttle.push([entry("a.excalidraw")]);
    throttle.cancel();
    vi.advanceTimersByTime(SCAN_PROGRESS_INTERVAL_MS * 3);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("scan + throttle", () => {
  it("many directories give few updates and an exact final list", async () => {
    const repo = new FakeVaultRepository();
    for (let i = 0; i < 40; i++) {
      repo.seedDrawing(`f${i}/d.excalidraw`, BLANK_SCENE);
    }
    const emit = vi.fn();
    const throttle = createProgressThrottle(emit);
    const final = await scanVaultMetadata(repo, repo.handle, undefined, (p) =>
      throttle.push(p),
    );
    throttle.cancel();
    // 41 directories were listed; at most a handful of snapshots, not 41.
    expect(emit.mock.calls.length).toBeLessThan(5);
    expect(final.map((e) => e.path).sort()).toEqual(
      [
        ...Array.from({ length: 40 }, (_, i) => `f${i}`),
        ...Array.from({ length: 40 }, (_, i) => `f${i}/d.excalidraw`),
      ].sort(),
    );
  });

  it("an aborted scan returns [] and emits nothing after cancel", async () => {
    vi.useFakeTimers();
    try {
      const repo = new FakeVaultRepository();
      repo.seedDrawing("a/b.excalidraw", BLANK_SCENE);
      const controller = new AbortController();
      const emit = vi.fn();
      const throttle = createProgressThrottle(emit);
      const scan = scanVaultMetadata(
        repo,
        repo.handle,
        controller.signal,
        (p) => throttle.push(p),
      );
      controller.abort();
      expect(await scan).toEqual([]);
      throttle.cancel();
      vi.advanceTimersByTime(SCAN_PROGRESS_INTERVAL_MS * 3);
      expect(emit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("scan yields to input", () => {
  it("waits on pause before each subfolder (not the root) and lists nothing while paused", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a/x.excalidraw", BLANK_SCENE);
    repo.seedDrawing("b/y.excalidraw", BLANK_SCENE);
    const listed = vi.spyOn(repo, "listDirectory");
    let release!: () => void;
    const pause = vi.fn(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const scan = scanVaultMetadata(
      repo,
      repo.handle,
      undefined,
      undefined,
      pause,
    );
    await vi.waitFor(() => expect(pause).toHaveBeenCalledTimes(1));
    // Only the root was listed; the walk waits for input to go quiet.
    expect(listed.mock.calls.map(([, p]) => p)).toEqual([""]);
    release();
    await vi.waitFor(() => expect(pause).toHaveBeenCalledTimes(2));
    expect(listed.mock.calls.map(([, p]) => p)).toEqual(["", "a"]);
    release();
    const final = await scan;
    expect(final.map((e) => e.path).sort()).toEqual(
      ["a", "a/x.excalidraw", "b", "b/y.excalidraw"].sort(),
    );
  });

  it("an abort during a pause ends the walk with nothing", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a/x.excalidraw", BLANK_SCENE);
    const controller = new AbortController();
    const scan = scanVaultMetadata(
      repo,
      repo.handle,
      controller.signal,
      undefined,
      async () => {
        controller.abort();
      },
    );
    expect(await scan).toEqual([]);
  });
});
