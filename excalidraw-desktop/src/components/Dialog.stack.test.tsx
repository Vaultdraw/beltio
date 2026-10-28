import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "./Dialog";

describe("Dialog stack", () => {
  it("Escape closes only the top dialog", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const { rerender } = render(
      <>
        <Dialog title="Outer" titleId="o" onClose={outer}>
          a
        </Dialog>
        <Dialog title="Inner" titleId="i" onClose={inner}>
          b
        </Dialog>
      </>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    rerender(
      <Dialog title="Outer" titleId="o" onClose={outer}>
        a
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("a headerless picker is labelled and has no close button", () => {
    const { getByRole, container } = render(
      <Dialog ariaLabel="Pick" onClose={() => {}}>
        <input />
      </Dialog>,
    );
    expect(getByRole("dialog", { name: "Pick" })).toBeTruthy();
    expect(container.querySelector(".vd-dialog--bare")).toBeTruthy();
    expect(container.querySelector(".vd-dialog__close")).toBeNull();
  });
});
