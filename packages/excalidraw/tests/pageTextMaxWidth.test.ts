import { describe, expect, it } from "vitest";

import { TEXT_MAX_WRAP_WIDTH } from "@excalidraw/common";

import { AppText } from "../components/App.text";
import {
  DEFAULT_PAGE_SETUP,
  getPresetPageSize,
} from "../data/pageSetup";

import type App from "../components/App";

/**
 * toimprove 177 (hunter F-3): typed and pasted text share getMaxTextWidth, so a pasted long text
 * in page mode wraps at the page width, not at min(view, 800 px).
 */
const maxWidth = (pageSetup: unknown) => {
  const app = {
    state: { width: 2000, zoom: { value: 1 }, pageSetup },
  } as unknown as App;
  const text = new AppText(app, {
    getContainer: () => null,
    getStylesPanelMode: () => "full",
  } as never);
  return text.getMaxTextWidth({ top: 0, right: 0, bottom: 0, left: 0 });
};

describe("getMaxTextWidth in page mode (typed and pasted text)", () => {
  it("is the wrap width when page mode is off", () => {
    expect(maxWidth(null)).toBe(TEXT_MAX_WRAP_WIDTH);
    expect(maxWidth({ ...DEFAULT_PAGE_SETUP, enabled: false })).toBe(
      TEXT_MAX_WRAP_WIDTH,
    );
  });

  it.each(["a5", "phone", "b5", "a4"] as const)(
    "never exceeds the %s page",
    (id) => {
      const size = getPresetPageSize(id, "portrait");
      const setup = { ...DEFAULT_PAGE_SETUP, ...size, enabled: true };
      expect(maxWidth(setup)).toBe(Math.min(setup.width, TEXT_MAX_WRAP_WIDTH));
    },
  );
});
