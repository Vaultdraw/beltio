/**
 * Regressions for the list.* panel keys that need the real components:
 * the focus-tree request is consumed once, and Space on a Settings tab
 * selects it without entering the page.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRegisteredHandler } from "../commands/handlerRegistry";
import { FOCUS_TREE_COMMAND_ID } from "../commands/listCommands";
import {
  installListKeysForTests,
  pressListKey,
} from "../commands/listKeysForTests";
import { SETTINGS_PAGES } from "../components/settings/schema";
import { Sidebar } from "../components/settings/Sidebar";
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
  name: "a",
  kind: "drawing",
  modifiedAt: 1,
  size: 1,
};
const props = (
  over: Partial<ComponentProps<typeof VaultNavigator>> = {},
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

describe("navigator.focusTree", () => {
  it("focuses the tree once; later search or collapse changes leave focus alone", () => {
    const p = props();
    const { rerender } = render(<VaultNavigator {...p} />);
    const tree = screen.getByRole("tree");
    act(() => {
      getRegisteredHandler(FOCUS_TREE_COMMAND_ID)!();
    });
    expect(document.activeElement).toBe(tree);

    // Elsewhere: type a search, clear it, collapse and expand the navigator.
    const search = screen.getByPlaceholderText(/Search drawings/);
    search.focus();
    fireEvent.change(search, { target: { value: "zz" } });
    fireEvent.change(search, { target: { value: "" } });
    expect(document.activeElement).toBe(search);
    rerender(<VaultNavigator {...p} collapsed />);
    rerender(<VaultNavigator {...p} collapsed={false} />);
    expect(document.activeElement).not.toBe(screen.getByRole("tree"));
  });

  it("from the tree, goes back out (a toggle)", () => {
    render(<VaultNavigator {...props()} />);
    const tree = screen.getByRole("tree");
    tree.focus();
    act(() => {
      getRegisteredHandler(FOCUS_TREE_COMMAND_ID)!();
    });
    expect(document.activeElement).not.toBe(tree);
  });

  it("d with no focused row never trashes the open drawing", () => {
    const p = props({ activePath: "a.excalidraw", confirmDelete: false });
    render(<VaultNavigator {...p} />);
    pressListKey(screen.getByRole("tree"), "d");
    pressListKey(screen.getByRole("tree"), "Backspace");
    expect(p.onTrashEntry).not.toHaveBeenCalled();
  });
});

describe("Settings page list", () => {
  it("Space selects the focused tab and stays; Enter enters the page", () => {
    const onSelectPage = vi.fn();
    const onEnterPage = vi.fn();
    render(
      <Sidebar
        pages={SETTINGS_PAGES}
        activePage={SETTINGS_PAGES[0].id}
        onSelectPage={onSelectPage}
        onEnterPage={onEnterPage}
        query=""
        onQueryChange={() => {}}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    pressListKey(tabs[0], "j");
    expect(document.activeElement).toBe(tabs[1]);
    pressListKey(tabs[1], " ", { code: "Space" });
    expect(onSelectPage).toHaveBeenLastCalledWith(SETTINGS_PAGES[1].id);
    expect(onEnterPage).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(tabs[1]);
    pressListKey(tabs[1], "Enter", { code: "Enter" });
    expect(onEnterPage).toHaveBeenCalledTimes(1);
  });
});
