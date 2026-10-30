/**
 * Hunter K (2026-10-30), K-5: on the welcome screen each recent vault is a row (role="button",
 * Enter or Space opens the vault) with a "Remove from recent list" button inside it. Pressing
 * Enter or Space on that button from the keyboard also reaches the row's own keydown handler
 * (`Onboarding.tsx` onKeyDown has no target check; only the click stops propagation), so the
 * vault the user wanted to forget is opened. A mouse click is fine. Obsidian's vault switcher
 * keeps "Remove from list" separate from opening; Zed's recent projects remove without opening.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Onboarding } from "./Onboarding";

const setup = () => {
  const onSelectRecent = vi.fn();
  const onRemoveRecent = vi.fn();
  render(
    <Onboarding
      recentVaults={["/Users/me/Old vault", "/Users/me/Work"]}
      lastVaultPath="/Users/me/Work"
      onOpenVault={() => {}}
      onCreateVault={() => {}}
      onSelectRecent={onSelectRecent}
      onRemoveRecent={onRemoveRecent}
    />,
  );
  const remove = screen.getByRole("button", {
    name: "Remove /Users/me/Old vault from recent list",
  });
  return { onSelectRecent, onRemoveRecent, remove };
};

describe("hunter K-5: removing a recent vault with the keyboard does not open it", () => {
  it("sanity: a click on remove removes and opens nothing; Enter on the row opens it", () => {
    const { onSelectRecent, onRemoveRecent, remove } = setup();
    fireEvent.click(remove);
    expect(onRemoveRecent).toHaveBeenCalledWith("/Users/me/Old vault");
    expect(onSelectRecent).not.toHaveBeenCalled();
    fireEvent.keyDown(remove.parentElement!, { key: "Enter" });
    expect(onSelectRecent).toHaveBeenCalledWith("/Users/me/Old vault");
  });

  it.fails.each([["Enter"], [" "]])(
    "toimprove 226: %j on the remove button does not open the vault",
    (key) => {
      const { onSelectRecent, remove } = setup();
      remove.focus();
      // The browser sends keydown to the focused button (it bubbles), then a click.
      fireEvent.keyDown(remove, { key });
      fireEvent.click(remove);
      expect(onSelectRecent).not.toHaveBeenCalled();
    },
  );
});
