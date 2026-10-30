import { describe, expect, it } from "vitest";

import { resolveLinkIndicatorColor } from "./useLinkIndicator";

describe("resolveLinkIndicatorColor", () => {
  it("accent follows the theme accent in light and dark", () => {
    expect(resolveLinkIndicatorColor("accent", "#89b4fa", false)).toBe(
      "#89b4fa",
    );
    expect(resolveLinkIndicatorColor("accent", "#89b4fa", true)).toBe(
      "#89b4fa",
    );
  });

  it("a fixed colour is kept in light mode and adapted in dark mode", () => {
    expect(resolveLinkIndicatorColor("#1971c2", "#89b4fa", false)).toBe(
      "#1971c2",
    );
    const dark = resolveLinkIndicatorColor("#1971c2", "#89b4fa", true);
    expect(dark).toMatch(/^#[0-9a-f]{6}$/i);
    expect(dark).not.toBe("#89b4fa");
  });

  it("an invalid colour falls back to the accent", () => {
    expect(resolveLinkIndicatorColor("red", "#89b4fa", false)).toBe("#89b4fa");
  });
});
