import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmModal } from "./ConfirmModal";
import { Dialog } from "./Dialog";

// Bug hunt round 3 (BH-14): Escape in a dialog opened over another dialog
// (Uninstall confirm over Community plugins) must close only the top one,
// like VS Code and Obsidian modals.
describe("stacked dialogs", () => {
  it("Escape closes only the topmost dialog", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Dialog title="Community plugins" titleId="a" onClose={outer}>
          body
        </Dialog>
        <ConfirmModal
          title="Uninstall X?"
          message="m"
          confirmLabel="Uninstall"
          onCancel={inner}
          onConfirm={() => {}}
        />
      </>,
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});
