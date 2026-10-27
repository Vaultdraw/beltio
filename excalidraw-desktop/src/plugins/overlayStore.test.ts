import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeOverlay,
  getOverlay,
  hasOverlay,
  showOverlay,
  subscribeOverlay,
  type OverlayEntry,
} from "./overlayStore";

const entry = (onClose?: () => void): OverlayEntry => ({
  pluginId: "p",
  Component: () => null,
  onClose,
});

afterEach(() => closeOverlay());

describe("overlayStore", () => {
  it("shows one overlay and closes the previous one first", () => {
    const first = vi.fn();
    const a = entry(first);
    const b = entry();
    showOverlay(a);
    expect(hasOverlay()).toBe(true);
    showOverlay(b);
    expect(getOverlay()).toBe(b);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("closes once, only the named entry, and tells subscribers", () => {
    const onClose = vi.fn();
    const a = entry(onClose);
    const seen = vi.fn();
    const off = subscribeOverlay(seen);
    showOverlay(a);
    closeOverlay(entry()); // some other entry: nothing happens
    expect(getOverlay()).toBe(a);
    closeOverlay(a);
    closeOverlay(a);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hasOverlay()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
    off();
  });
});
