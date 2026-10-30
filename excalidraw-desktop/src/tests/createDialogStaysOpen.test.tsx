/**
 * Hunter F-13 (toimprove 188), the real component instead of source text: the navigator's
 * New drawing / New folder dialog stays open with the typed name and the reason when the name is
 * refused (checked in the dialog) or the create fails (the handler throws, as VaultApp's
 * `createDrawingOrThrow` does for a taken name); it closes only on success.
 * Data-driven: kind x outcome.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installListKeysForTests } from "../commands/listKeysForTests";
import { VaultNavigator } from "../components/VaultNavigator";

import type { ComponentProps } from "react";
import type { VaultEntry } from "../vault/types";

let uninstall = () => {};
beforeEach(() => {
  window.localStorage.clear();
  uninstall = installListKeysForTests();
});
afterEach(() => {
  uninstall();
  cleanup();
});

const entry: VaultEntry = {
  path: "a.excalidraw",
  name: "a.excalidraw",
  kind: "drawing",
  modifiedAt: 1,
  size: 1,
};
const props = (
  over: Partial<ComponentProps<typeof VaultNavigator>>,
): ComponentProps<typeof VaultNavigator> => ({
  vault: { handle: "t", name: "T", path: "/t", readOnly: false },
  activePath: null,
  collapsed: false,
  onToggleCollapse: vi.fn(),
  onOpenDrawing: vi.fn(),
  onCreateDrawing: vi.fn(),
  onCreateFolder: vi.fn(),
  onRenameEntry: vi.fn(),
  onMoveEntry: vi.fn(),
  onDuplicateDrawing: vi.fn(),
  onTrashEntry: vi.fn(),
  onRevealEntry: vi.fn(),
  onSwitchVault: vi.fn(),
  treeNodes: [{ entry, children: [] } as never],
  expandedFolders: new Set(),
  onToggleFolder: vi.fn(),
  onExpandFolder: vi.fn(),
  allIndexedEntries: [entry],
  sortOrder: "name_asc",
  onSortChange: vi.fn(),
  confirmDelete: true,
  ...over,
});

const TAKEN = "A file named “Plan.excalidraw” already exists here.";

type Row = {
  kind: "drawing" | "folder";
  name: string;
  /** what the handler does */
  outcome: "ok" | "throws";
  /** the dialog stays open showing this text; null = it closes */
  shows: RegExp | null;
  called: boolean;
};
const ROWS: Row[] = [
  {
    kind: "drawing",
    name: "Plan",
    outcome: "throws",
    shows: /already exists/,
    called: true,
  },
  { kind: "drawing", name: "a:b", outcome: "ok", shows: /./, called: false },
  { kind: "drawing", name: "Plan", outcome: "ok", shows: null, called: true },
  {
    kind: "folder",
    name: "Ideas",
    outcome: "throws",
    shows: /already exists/,
    called: true,
  },
  { kind: "folder", name: ".hidden", outcome: "ok", shows: /./, called: false },
  { kind: "folder", name: "Ideas", outcome: "ok", shows: null, called: true },
];

describe("hunter F-13: the create dialog stays open until the create works", () => {
  it.each(ROWS)("$kind '$name', handler $outcome", async (row) => {
    const handler = vi.fn(async () => {
      if (row.outcome === "throws") {
        throw new Error(TAKEN);
      }
    });
    render(
      <VaultNavigator
        {...props(
          row.kind === "drawing"
            ? { onCreateDrawing: handler }
            : { onCreateFolder: handler },
        )}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: row.kind === "drawing" ? "New drawing" : "New folder",
      }),
    );
    const input = (await screen.findByLabelText("Name")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: row.name } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
    });
    expect(handler).toHaveBeenCalledTimes(row.called ? 1 : 0);
    const still = screen.queryByLabelText("Name") as HTMLInputElement | null;
    if (row.shows === null) {
      expect(still).toBeNull();
    } else {
      expect(still?.value).toBe(row.name);
      const error = document.querySelector(".vault-error-text");
      expect(error?.textContent ?? "").toMatch(row.shows);
    }
  });
});
