import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useNavigatorOverlay } from "./useNavigatorOverlay";

const esc = () =>
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useNavigatorOverlay (narrow file list)", () => {
  it("Esc closes the overlay only while it is open", () => {
    const close = vi.fn();
    const { rerender } = renderHook(
      ({ open }) => useNavigatorOverlay(document, open, close, "a"),
      { initialProps: { open: false } },
    );
    esc();
    expect(close).not.toHaveBeenCalled();
    rerender({ open: true });
    esc();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("leaves Esc to an open dialog or menu", () => {
    const close = vi.fn();
    document.body.innerHTML = '<div role="dialog"></div>';
    renderHook(() => useNavigatorOverlay(document, true, close, "a"));
    esc();
    expect(close).not.toHaveBeenCalled();
  });

  it("opening a file (the content key changes) closes it; the first key does not", () => {
    const close = vi.fn();
    const { rerender } = renderHook(
      ({ k }) => useNavigatorOverlay(document, true, close, k),
      { initialProps: { k: "a" } },
    );
    expect(close).not.toHaveBeenCalled();
    rerender({ k: "b" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("focus returns to where it was when the overlay closes", () => {
    document.body.innerHTML = "<button id='b'>x</button>";
    const b = document.getElementById("b")!;
    b.focus();
    const { rerender } = renderHook(
      ({ open }) => useNavigatorOverlay(document, open, () => {}, "a"),
      { initialProps: { open: true } },
    );
    (document.activeElement as HTMLElement).blur();
    rerender({ open: false });
    expect(document.activeElement).toBe(b);
  });
});
