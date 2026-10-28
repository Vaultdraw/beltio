import { afterEach, describe, expect, it } from "vitest";

import { updatePreferences } from "../../vault/preferences";

import { startsAtLaunch } from "./apply";

afterEach(() => updatePreferences({ pluginSettings: {} }, window));

describe("startsAtLaunch", () => {
  it("skips auto-export while its enabled switch is not true", () => {
    updatePreferences({ pluginSettings: {} }, window);
    expect(startsAtLaunch("auto-export", window)).toBe(false);
    updatePreferences(
      { pluginSettings: { "auto-export": { enabled: false } } },
      window,
    );
    expect(startsAtLaunch("auto-export", window)).toBe(false);
  });

  it("starts auto-export when enabled, and other plugins always", () => {
    updatePreferences(
      { pluginSettings: { "auto-export": { enabled: true } } },
      window,
    );
    expect(startsAtLaunch("auto-export", window)).toBe(true);
    expect(startsAtLaunch("favourites", window)).toBe(true);
    expect(startsAtLaunch("some-user-plugin", window)).toBe(true);
  });
});
