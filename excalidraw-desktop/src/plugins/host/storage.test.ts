import { afterEach, describe, expect, it, vi } from "vitest";

import { boot } from "../testing";

import { getPluginCost } from "./cost";
import { toApiError } from "./gateway";
import {
  STORAGE_DEBOUNCE_MS,
  STORAGE_MAX_WAIT_MS,
  createPluginStore,
  pluginStoreCount,
  type StorageDeps,
} from "./storage";

import type { Json, Plugin, PluginContext } from "../api";

/** A store over an in-memory "disk" with a manual clock. */
const harness = (initial: string | null = null, corrupt = false) => {
  let disk = initial;
  let now = 0;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const io = {
    reads: 0,
    writes: [] as string[],
    failNext: false,
    read: vi.fn(async () => {
      io.reads++;
      return {
        data: disk === null ? null : (JSON.parse(disk) as Record<string, Json>),
        corrupt,
      };
    }),
    write: vi.fn(async (text: string) => {
      if (io.failNext) {
        io.failNext = false;
        throw new Error("disk full");
      }
      io.writes.push(text);
      disk = text;
    }),
  };
  const corrupts: number[] = [];
  const errors: unknown[] = [];
  let limitKb = 1;
  const deps: StorageDeps = {
    io,
    limitKb: () => limitKb,
    onCorrupt: () => corrupts.push(1),
    onWriteError: (e) => errors.push(e),
    setTimer: (fn, ms) => {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      (t as { live: boolean }).live = false;
    },
    now: () => now,
  };
  const advance = async (ms: number) => {
    now += ms;
    for (const t of timers) {
      if (t.live && t.at <= now) {
        t.live = false;
        t.fn();
      }
    }
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return {
    store: createPluginStore(deps),
    io,
    advance,
    corrupts,
    errors,
    disk: () => disk,
    setLimitKb: (n: number) => {
      limitKb = n;
    },
  };
};

describe("ctx.storage.global store", () => {
  it("reads nothing until the first call and writes nothing for reads", async () => {
    const h = harness('{"a":1}');
    expect(h.io.reads).toBe(0);
    expect(await h.store.get("a")).toBe(1);
    expect(await h.store.get("missing")).toBeUndefined();
    expect(await h.store.keys()).toEqual(["a"]);
    expect(h.io.reads).toBe(1);
    await h.advance(5000);
    expect(h.io.writes).toEqual([]);
  });

  it("returns fresh copies", async () => {
    const h = harness();
    await h.store.set("o", { list: [1] });
    const a = (await h.store.get<{ list: number[] }>("o"))!;
    a.list.push(2);
    expect(await h.store.get("o")).toEqual({ list: [1] });
  });

  it("debounces writes and writes the whole object once", async () => {
    const h = harness();
    await h.store.set("a", 1);
    await h.advance(STORAGE_DEBOUNCE_MS - 1);
    await h.store.set("b", "x");
    await h.advance(STORAGE_DEBOUNCE_MS - 1);
    expect(h.io.writes).toEqual([]);
    await h.advance(1);
    expect(h.io.writes).toEqual(['{"a":1,"b":"x"}']);
  });

  it("writes within the maximum wait under a steady stream of changes", async () => {
    const h = harness();
    for (let i = 0; i < 20; i++) {
      await h.store.set("n", i);
      await h.advance(STORAGE_DEBOUNCE_MS / 2);
      if (h.io.writes.length) {
        break;
      }
    }
    expect(h.io.writes.length).toBe(1);
    expect(JSON.parse(h.io.writes[0]).n).toBeLessThanOrEqual(
      Math.ceil(STORAGE_MAX_WAIT_MS / (STORAGE_DEBOUNCE_MS / 2)),
    );
  });

  it("skips writes when nothing changed", async () => {
    const h = harness('{"a":1}');
    await h.store.set("a", 1);
    await h.advance(5000);
    expect(h.io.writes).toEqual([]);
    await h.store.set("a", 2);
    await h.store.set("a", 1);
    await h.advance(5000);
    expect(h.io.writes).toEqual([]);
    await h.store.delete("missing");
    await h.advance(5000);
    expect(h.io.writes).toEqual([]);
  });

  it("delete removes a key and writes", async () => {
    const h = harness('{"a":1,"b":2}');
    await h.store.delete("a");
    await h.store.flush();
    expect(h.disk()).toBe('{"b":2}');
  });

  it("flush writes pending changes at once", async () => {
    const h = harness();
    await h.store.set("a", true);
    await h.store.flush();
    expect(h.io.writes).toEqual(['{"a":true}']);
    await h.advance(5000);
    expect(h.io.writes.length).toBe(1);
  });

  it("refuses over the limit with QUOTA and keeps the old value", async () => {
    const h = harness();
    h.setLimitKb(1);
    await h.store.set("a", "x".repeat(900));
    await expect(h.store.set("b", "y".repeat(200))).rejects.toMatchObject({
      code: "QUOTA",
    });
    expect(await h.store.keys()).toEqual(["a"]);
    // Replacing a value counts only the difference.
    await h.store.set("a", "z".repeat(1000));
    // Exactly at the limit is allowed: {"a":"…"} is 1024 bytes.
    await h.store.set("a", "z".repeat(1024 - 8));
    await expect(h.store.set("a", "z".repeat(1024 - 7))).rejects.toMatchObject({
      code: "QUOTA",
    });
    // The limit is read on every set (live config).
    h.setLimitKb(2);
    await h.store.set("b", "y".repeat(500));
    await h.store.flush();
    expect(new TextEncoder().encode(h.disk()!).length).toBeLessThanOrEqual(
      2048,
    );
  });

  it("counts UTF-8 bytes, not characters", async () => {
    const h = harness();
    h.setLimitKb(1);
    // 400 three-byte characters = 1200 bytes.
    await expect(h.store.set("a", "€".repeat(400))).rejects.toMatchObject({
      code: "QUOTA",
    });
  });

  it("refuses bad keys and values that are not JSON", async () => {
    const h = harness();
    await expect(h.store.set("", 1)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(h.store.get("k".repeat(257))).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const v of [
      undefined,
      NaN,
      Infinity,
      () => 1,
      new Date(),
      new Map(),
      cyclic,
      [1, undefined],
    ]) {
      await expect(h.store.set("k", v as Json)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
    }
    expect(h.io.reads).toBe(0);
  });

  it("starts empty after a corrupt file, tells once, and writes on the next change", async () => {
    const h = harness(null, true);
    expect(await h.store.keys()).toEqual([]);
    expect(h.corrupts).toEqual([1]);
    await h.store.set("a", 1);
    await h.store.flush();
    expect(h.disk()).toBe('{"a":1}');
  });

  it("keeps changes after a failed write and retries on flush", async () => {
    const h = harness();
    h.io.failNext = true;
    await h.store.set("a", 1);
    await h.store.flush();
    expect(h.errors.length).toBe(1);
    expect(h.disk()).toBeNull();
    await h.store.flush();
    expect(h.disk()).toBe('{"a":1}');
  });

  it("reset drops memory and the pending write (Delete data)", async () => {
    const h = harness('{"a":1}');
    await h.store.set("b", 2);
    h.store.reset();
    await h.advance(5000);
    expect(h.io.writes).toEqual([]);
    expect(await h.store.keys()).toEqual(["a"]);
    expect(h.io.reads).toBe(2);
  });

  it("gateway errors become Errors with a code and detail", () => {
    const e = toApiError({
      code: "CONFLICT",
      message: "dirty",
      reason: "dirty",
    }) as Error & { code: string; reason: string };
    expect(e).toBeInstanceOf(Error);
    expect([e.code, e.message, e.reason]).toEqual([
      "CONFLICT",
      "dirty",
      "dirty",
    ]);
  });
});

describe("ctx.storage through the real host", () => {
  let dispose: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await dispose?.();
    dispose = null;
  });

  const capture = () => {
    const seen: { ctx?: PluginContext } = {};
    const plugin: Plugin = {
      activate(ctx) {
        seen.ctx = ctx;
      },
    };
    return { seen, plugin };
  };

  it("costs nothing until a plugin touches ctx.storage", async () => {
    const { seen, plugin } = capture();
    const p = await boot(
      { id: "kv-idle", activation: ["onStartupFinished"] },
      plugin,
    );
    dispose = p.dispose;
    expect(seen.ctx).toBeDefined();
    expect(pluginStoreCount()).toBe(0);
    expect(getPluginCost("kv-idle")?.gateway ?? {}).toEqual({});
    // Reading the namespace builds it, still without a gateway call.
    void seen.ctx!.storage.global;
    expect(getPluginCost("kv-idle")?.gateway ?? {}).toEqual({});
  });

  it("round-trips through the gateway, counts the cost and flushes on disable", async () => {
    const { seen, plugin } = capture();
    const p = await boot(
      { id: "kv-user", activation: ["onStartupFinished"] },
      plugin,
    );
    dispose = p.dispose;
    p.storage.seed({ count: 1 });
    const kv = seen.ctx!.storage.global;
    expect(await kv.get("count")).toBe(1);
    await kv.set("count", 2);
    await p.disable();
    expect(p.storage.data()).toEqual({ count: 2 });
    const cost = getPluginCost("kv-user")!.gateway;
    expect(cost["storage.read"].calls).toBe(1);
    expect(cost["storage.write"].calls).toBe(1);
    expect(cost["storage.write"].bytes).toBe('{"count":2}'.length);
  });

  it("follows plugins.storage_limit_kb", async () => {
    const { seen, plugin } = capture();
    const p = await boot(
      { id: "kv-limit", activation: ["onStartupFinished"] },
      plugin,
    );
    dispose = p.dispose;
    p.storage.setLimitKb(64);
    await expect(
      seen.ctx!.storage.global.set("big", "x".repeat(70 * 1024)),
    ).rejects.toMatchObject({ code: "QUOTA" });
  });
});

describe("Delete data while a plugin runs", () => {
  it("waits for a write in flight, blocks reads until the file is gone, then starts empty", async () => {
    let disk: string | null = '{"a":1}';
    let releaseWrite!: () => void;
    const store = createPluginStore({
      io: {
        read: async () => ({
          data: disk === null ? null : JSON.parse(disk),
          corrupt: false,
        }),
        write: (text) =>
          new Promise<void>((resolve) => {
            releaseWrite = () => {
              disk = text;
              resolve();
            };
          }),
      },
      limitKb: () => 1024,
      onCorrupt() {},
      onWriteError() {},
      setTimer: () => 0,
      clearTimer() {},
      now: () => 0,
    });
    await store.set("b", 2);
    const flushing = store.flush();
    for (let i = 0; i < 5; i++) {
      await Promise.resolve(); // the write reaches Rust and has not finished
    }
    const order: string[] = [];
    const wiped = store.wipe(async () => {
      order.push("delete");
      disk = null;
      return true;
    });
    const read = store.keys().then((k) => {
      order.push("read");
      return k;
    });
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
    expect(order).toEqual([]);
    releaseWrite();
    await flushing;
    expect(await wiped).toBe(true);
    expect(await read).toEqual([]);
    expect(order).toEqual(["delete", "read"]);
  });
});
