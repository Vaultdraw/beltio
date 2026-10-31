/**
 * Family hunter shell (2026-10-31): "a popover closed leaves focus on its opener" (toimprove 221
 * fixed the row and sort menus; the tab menu and tab list already restore it). Another member is
 * the header's Read-Only badge: its panel opens under the badge, and "Try again" and Escape both
 * close it. When focus is on "Try again" (Tab from the badge, Enter) the panel unmounts around the
 * focused button and focus falls to the page, so the next Tab starts at the top of the window.
 * WAI-ARIA disclosure and Obsidian's modals return focus to the control that opened them.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReadOnlyBadge } from "./ReadOnlyBadge";

import type { VaultInfo } from "../../vault/types";

const vault = {
  handle: "h",
  path: "/v",
  name: "v",
  readOnly: true,
  readOnlyReason: "lockedByOtherProcess",
  lockHolderPid: 99,
} as VaultInfo;

const open = () => {
  render(<ReadOnlyBadge vault={vault} onRetry={async () => {}} />);
  const badge = screen.getByRole("button", { name: /Read-Only/ });
  badge.focus();
  fireEvent.click(badge);
  return badge;
};

describe("family (shell hunter): a closed popover hands focus back to its opener", () => {
  it("sanity: the panel opens from the badge and Escape closes it", () => {
    const badge = open();
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(badge);
  });

  it("Read-Only badge: Try again from the keyboard leaves focus on the badge (toimprove 305)", async () => {
    const badge = open();
    const retry = screen.getByRole("button", { name: "Try again" });
    retry.focus();
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(badge);
  });

  it("Read-Only badge: Escape with focus inside the panel leaves focus on the badge (toimprove 305)", () => {
    const badge = open();
    screen.getByRole("button", { name: "Try again" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(badge);
  });
});
