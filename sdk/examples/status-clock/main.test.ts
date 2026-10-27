import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { readExample } from "../testing/readManifest";

import plugin from "./main.js";

let p: TestPlugin | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 28, 9, 5, 7));
});
afterEach(async () => {
  await p?.dispose();
  p = undefined;
  vi.useRealTimers();
});

describe("status-clock", () => {
  it("declares one status item and shows the time at startup", async () => {
    p = await boot(readExample("status-clock"), plugin);
    expect(p.info.contributes.status_bar).toEqual([
      {
        id: "clock",
        title: "Clock",
        align: "right",
        priority: 10,
        command: "toggle-seconds",
      },
    ]);
    expect(p.statusBar().map((i) => i.text)).toEqual(["09:05"]);
    expect(p.timers()).toBe(1);
  });

  it("a click runs the command: seconds appear and the timer speeds up", async () => {
    p = await boot(readExample("status-clock"), plugin);
    await p.clickStatusBar("clock");
    expect(p.statusBar()[0].text).toBe("09:05:07");
    await vi.advanceTimersByTimeAsync(2000);
    expect(p.statusBar()[0].text).toBe("09:05:09");
    expect(p.timers()).toBe(1);
  });

  it("disable removes the item and the timer", async () => {
    p = await boot(readExample("status-clock"), plugin);
    await p.disable();
    expect(p.statusBar()).toEqual([]);
    expect(p.timers()).toBe(0);
  });
});
