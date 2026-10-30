import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RenameModal } from "./RenameModal";

/**
 * Hunter E (2026-10-30, quiet): the Rename dialog had no test of its own. Rows that fail today are
 * `it.fails`; drop `fails` when fixed.
 *
 * E-6: pressing Rename with the name unchanged sends the same path as the new path. The native core
 * answers "Cannot move an entry into itself" (fsops.rs move_entry_paths, `from == to`), and
 * VaultApp.handleRenameEntry shows it as a red alert "Couldn't rename ...". Obsidian and Zed close
 * the rename with nothing to do.
 *
 * E-7: the hint says "The extension is kept automatically", yet a typed extension is added again
 * (Idea.excalidraw.excalidraw); the New drawing dialog strips a typed extension.
 */
const submit = (name: string) => {
  fireEvent.change(screen.getByLabelText("New name"), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
};

describe("hunter E: Rename dialog", () => {
  it("E-6 an unchanged name renames nothing and asks the host for nothing", () => {
    const onRename = vi.fn();
    render(
      <RenameModal
        initialName="Idea.excalidraw"
        kind="drawing"
        onRename={onRename}
        onCancel={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(onRename).not.toHaveBeenCalled();
  });

  it("E-7 a typed extension is not added twice", () => {
    const onRename = vi.fn();
    render(
      <RenameModal
        initialName="Idea.excalidraw"
        kind="drawing"
        onRename={onRename}
        onCancel={() => undefined}
      />,
    );
    submit("Plan.excalidraw");
    expect(onRename).toHaveBeenCalledWith("Plan.excalidraw");
  });

  it("E-7b a note typed with .md is not renamed to .md.md", () => {
    const onRename = vi.fn();
    render(
      <RenameModal
        initialName="Idea.md"
        kind="note"
        onRename={onRename}
        onCancel={() => undefined}
      />,
    );
    submit("Plan.md");
    expect(onRename).toHaveBeenCalledWith("Plan.md");
  });
});
