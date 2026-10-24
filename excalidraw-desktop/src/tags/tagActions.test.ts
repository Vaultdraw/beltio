import { describe, expect, it, vi } from "vitest";

import { registerTagSectionToggle, toggleTagSection } from "./tagActions";

describe("tags section toggle slot", () => {
  it("runs the mounted pane's toggle, and nothing once it unmounts", () => {
    const toggle = vi.fn();
    const off = registerTagSectionToggle(toggle);
    toggleTagSection();
    expect(toggle).toHaveBeenCalledTimes(1);
    off();
    toggleTagSection();
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});
