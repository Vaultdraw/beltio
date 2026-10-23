import { describe, expect, it, vi } from "vitest";

import { createDevLogSink, DEV_LOG_FLUSH_MS } from "./devLog";
import { logLine, setDevLogSink } from "./errors";

const settle = () => new Promise((r) => setTimeout(r, 0));

const setup = (dev: string[] = ["mine"]) => {
  const sent: [string, string][] = [];
  let tick: (() => void) | null = null;
  const timers = vi.fn((fn: () => void) => {
    tick = fn;
    return 1;
  });
  const sink = createDevLogSink({
    isDev: (id) => dev.includes(id),
    send: async (id, text) => {
      sent.push([id, text]);
    },
    setTimer: timers,
    now: () => new Date("2026-10-24T04:00:00.000Z"),
  });
  return { sink, sent, timers, fire: () => tick?.() };
};

describe("dev log sink", () => {
  it("does nothing for a plugin that is not dev", () => {
    const { sink, sent, timers, fire } = setup();
    sink("other", "info", "hello");
    fire();
    expect(timers).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("batches lines of one plugin into one send with a time and a level", async () => {
    const { sink, sent, timers, fire } = setup();
    sink("mine", "info", "one");
    sink("mine", "error", "two");
    expect(timers).toHaveBeenCalledTimes(1);
    expect(timers).toHaveBeenCalledWith(expect.any(Function), DEV_LOG_FLUSH_MS);
    expect(sent).toEqual([]);
    fire();
    await settle();
    expect(sent).toEqual([
      [
        "mine",
        "2026-10-24T04:00:00.000Z [info] one\n2026-10-24T04:00:00.000Z [error] two\n",
      ],
    ]);
  });

  it("splits a very large batch into several sends and never throws on a failed send", async () => {
    const sent: string[] = [];
    let fire: () => void = () => {};
    const sink = createDevLogSink({
      isDev: () => true,
      send: (_id, text) => {
        sent.push(text);
        return Promise.reject(new Error("disk full"));
      },
      setTimer: (fn) => {
        fire = fn;
        return 1;
      },
      now: () => new Date(0),
    });
    for (let i = 0; i < 20; i++) {
      sink("mine", "info", "x".repeat(3900));
    }
    expect(() => fire()).not.toThrow();
    await settle();
    expect(sent.length).toBeGreaterThan(1);
    expect(Math.max(...sent.map((s) => s.length))).toBeLessThanOrEqual(36_000);
  });

  it("sends one batch after the other, in order", async () => {
    const order: string[] = [];
    let fire: () => void = () => {};
    const sink = createDevLogSink({
      isDev: () => true,
      send: async (_id, text) => {
        order.push(`start ${text.length > 40000 ? "big" : "small"}`);
        await new Promise((r) => setTimeout(r, 5));
        order.push("end");
      },
      setTimer: (fn) => {
        fire = fn;
        return 1;
      },
      now: () => new Date(0),
    });
    for (let i = 0; i < 20; i++) {
      sink("mine", "info", "x".repeat(3900));
    }
    fire();
    await new Promise((r) => setTimeout(r, 60));
    expect(order.filter((o) => o === "end").length).toBeGreaterThan(1);
    // never two starts in a row: each send ends before the next starts
    expect(order.join(",")).not.toMatch(/start [a-z]+,start/);
  });

  it("is fed by logLine and can be removed", async () => {
    const { sink, sent, fire } = setup();
    setDevLogSink(sink);
    logLine("mine", "warn", "from the host");
    fire();
    await settle();
    expect(sent[0][1]).toContain("[warn] from the host");
    setDevLogSink(null);
    logLine("mine", "warn", "after");
    fire();
    await settle();
    expect(sent).toHaveLength(1);
  });
});
