import { describe, expect, it } from "vitest";

import { watchFallbackMessage } from "./watchFallbackNotice";
import { DEFAULT_WATCH_POLL_MS, isWatchPollMs } from "./watchPoll";

describe("file watcher fallback notice", () => {
  it("names the inotify setting for the watch limit, with the interval", () => {
    const text = watchFallbackMessage({
      reason: "limitReached",
      intervalMs: 5000,
    });
    expect(text).toContain("fs.inotify.max_user_watches");
    expect(text).toContain("every 5 s");
  });

  it("says plainly that watching failed for other errors", () => {
    const text = watchFallbackMessage({ reason: "failed", intervalMs: 2500 });
    expect(text).not.toContain("inotify");
    expect(text).toContain("every 2.5 s");
  });

  it("accepts whole milliseconds between 500 and 600000 only", () => {
    expect(isWatchPollMs(DEFAULT_WATCH_POLL_MS)).toBe(true);
    for (const bad of [499, 600_001, 1500.5, "5000", null]) {
      expect(isWatchPollMs(bad)).toBe(false);
    }
  });
});
