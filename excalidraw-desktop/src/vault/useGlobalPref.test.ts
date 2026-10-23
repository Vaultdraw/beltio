import { afterEach, describe, expect, it, vi } from "vitest";

import { updatePreferences } from "./preferences";
import { cachedPreferences } from "./useGlobalPref";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("cachedPreferences", () => {
  it("reads storage once per preferences change, not per call", () => {
    // Review #8: useStartMode read localStorage several times per VaultApp render.
    updatePreferences({ searchStart: "use" }, window);
    const read = vi.spyOn(Storage.prototype, "getItem");
    const first = cachedPreferences(window);
    for (let i = 0; i < 10; i++) {
      expect(cachedPreferences(window)).toBe(first);
    }
    expect(read.mock.calls.length).toBeLessThanOrEqual(1);
    updatePreferences({ searchStart: "open" }, window);
    expect(cachedPreferences(window).searchStart).toBe("open");
  });
});
