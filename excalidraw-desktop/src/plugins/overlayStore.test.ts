import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeOverlay,
  getOverlay,
  hasCoveringOverlay,
  hasOverlay,
  reopenYielded,
  showOverlay,
  subscribeOverlay,
  yieldOverlay,
  type OverlayEntry,
} from "./overlayStore";

const entry = (onClose?: () => void): OverlayEntry => ({
  pluginId: "p",
  Component: () => null,
  onClose,
});

afterEach(() => {
  closeOverlay();
  yieldOverlay(); // forgets a dismissed view
});

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

  describe("yielding to an opened file", () => {
    it("a covering view gives way, keeps its onClose for later, and Back brings it back once", () => {
      const onClose = vi.fn();
      const a = entry(onClose);
      showOverlay(a);
      yieldOverlay();
      expect(hasCoveringOverlay()).toBe(false);
      expect(onClose).not.toHaveBeenCalled();
      expect(reopenYielded()).toBe(true);
      expect(getOverlay()).toBe(a);
      expect(reopenYielded()).toBe(false);
      closeOverlay(a);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("a second navigation forgets the dismissed view and runs its onClose", () => {
      const onClose = vi.fn();
      showOverlay(entry(onClose));
      yieldOverlay();
      yieldOverlay(); // the next file opened: no view is open any more
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(reopenYielded()).toBe(false);
    });

    it("opening another view forgets the dismissed one", () => {
      const onClose = vi.fn();
      showOverlay(entry(onClose));
      yieldOverlay();
      showOverlay(entry());
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(reopenYielded()).toBe(false);
    });

    it("a modal dialog is closed, not remembered", () => {
      const onClose = vi.fn();
      showOverlay({ ...entry(onClose), modal: true });
      yieldOverlay();
      expect(hasOverlay()).toBe(false);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(reopenYielded()).toBe(false);
    });

    it("the plugin closing its dismissed view forgets it", () => {
      const a = entry();
      showOverlay(a);
      yieldOverlay();
      closeOverlay(a);
      expect(reopenYielded()).toBe(false);
    });
  });
});
