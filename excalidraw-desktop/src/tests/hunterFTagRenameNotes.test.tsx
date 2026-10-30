import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import RenameTagDialog from "../components/tags/RenameTagDialog";

import type { VaultTagRename } from "../tags/types";

/**
 * Hunter F-15 (2026-10-30). The native tag rename never edits notes ("Notes are not edited by a
 * tag rename", `src-tauri/src/links/tag_rename.rs:76`), but the tag list (and its counts) is built
 * from every indexed file, notes included. For a tag that lives only in notes, the dialog shows
 * "0 occurrences in 0 drawings", leaves Rename enabled and says nothing about notes; pressing it
 * reports success and the pane still lists the old tag.
 */
afterEach(cleanup);

const api = {
  plan: vi.fn(async (_h: string, from: string, to: string) => ({
    from,
    to,
    files: 0,
    occurrences: 0,
    merges: false,
    keys: [],
  })),
  rename: vi.fn(),
} as unknown as VaultTagRename;

describe("hunter F-15: renaming a tag that only notes carry", () => {
  it("(context) the plan finds nothing to change", async () => {
    render(
      <RenameTagDialog
        api={api}
        handle="h"
        tags={() => [{ tag: "project", display: "project", count: 3 }]}
        initial={{ key: "project", display: "project" }}
        onConfirm={async () => {}}
        onCancel={() => {}}
        ownerDocument={document}
        debounceMs={0}
      />,
    );
    fireEvent.change(screen.getByLabelText("New tag"), {
      target: { value: "proj" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("rename-tag-plan")).toBeTruthy(),
    );
    expect(screen.getByTestId("rename-tag-plan").textContent).toMatch(
      /0 occurrences in 0 drawings/,
    );
  });

  it.fails(
    "a rename that changes nothing is not offered, or says why (notes are not edited)",
    async () => {
      render(
        <RenameTagDialog
          api={api}
          handle="h"
          tags={() => [{ tag: "project", display: "project", count: 3 }]}
          initial={{ key: "project", display: "project" }}
          onConfirm={async () => {}}
          onCancel={() => {}}
          ownerDocument={document}
          debounceMs={0}
        />,
      );
      fireEvent.change(screen.getByLabelText("New tag"), {
        target: { value: "proj" },
      });
      await waitFor(() =>
        expect(screen.getByTestId("rename-tag-plan")).toBeTruthy(),
      );
      const button = screen.getByRole("button", {
        name: "Rename",
      }) as HTMLButtonElement;
      const text = screen.getByTestId("rename-tag-plan").textContent ?? "";
      expect(button.disabled || /note/i.test(text)).toBe(true);
    },
  );
});
