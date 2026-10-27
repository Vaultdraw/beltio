/**
 * Graph view UI entry points: the navigator button, a drawing row's
 * "Open local graph" and the useGraphEntry glue that dispatches graph.open /
 * graph.openLocal.
 */
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GraphViewButton } from "../components/GraphViewButton";
import { VaultNavigator } from "../components/VaultNavigator";
import { GRAPH_COMMAND_IDS } from "../commands/graphCommands";
import { registerCommands } from "../commands/registry";
import { setHotkeyOverride } from "../commands/useCommands";
import { officialCommandDefs } from "../plugins/boot";
import { OFFICIAL_PLUGINS } from "../plugins/officialPlugins";
import { useGraphEntry } from "../commands/useGraphEntry";

import type { ComponentProps } from "react";

import type { VaultEntry, VaultInfo } from "../vault/types";

afterEach(() => window.localStorage.clear());

const vault: VaultInfo = {
  handle: "g",
  name: "G",
  path: "/tmp/G",
  readOnly: false,
};
const drawing: VaultEntry = {
  path: "a.excalidraw",
  name: "a",
  kind: "drawing",
  modifiedAt: 1,
  size: 1,
};
const folder: VaultEntry = { ...drawing, path: "F", name: "F", kind: "folder" };

const navProps = (
  over: Partial<ComponentProps<typeof VaultNavigator>> = {},
): ComponentProps<typeof VaultNavigator> => ({
  vault,
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
  treeNodes: [
    { entry: folder, children: [] } as never,
    { entry: drawing, children: [] } as never,
  ],
  expandedFolders: new Set(),
  onToggleFolder: vi.fn(),
  onExpandFolder: vi.fn(),
  allIndexedEntries: [drawing],
  sortOrder: "name_asc",
  onSortChange: vi.fn(),
  confirmDelete: true,
  ...over,
});

// The graph's commands come from the official plugin's stubs (registered at boot in the app).
let releaseGraphStubs: () => void;
beforeEach(() => {
  releaseGraphStubs = registerCommands(
    officialCommandDefs(OFFICIAL_PLUGINS.find((p) => p.id === "graph")!),
  );
});
afterEach(() => releaseGraphStubs());

describe("GraphViewButton", () => {
  it("names the command and its current key, following a rebind", () => {
    const onClick = vi.fn();
    render(<GraphViewButton onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Graph view" });
    expect(button.title).toMatch(
      /^Graph view \((Cmd\+Option\+G|Ctrl\+Alt\+G)\)$/,
    );
    act(() => setHotkeyOverride(GRAPH_COMMAND_IDS.open, ["Mod+Shift+K"]));
    expect(button.title).toMatch(
      /^Graph view \((Cmd\+Shift\+K|Ctrl\+Shift\+K)\)$/,
    );
    act(() => setHotkeyOverride(GRAPH_COMMAND_IDS.open, []));
    expect(button.title).toBe("Graph view");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is pressed while the graph is showing", () => {
    render(<GraphViewButton onClick={vi.fn()} pressed />);
    expect(screen.getByRole("button", { name: "Graph view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("VaultNavigator graph entry points", () => {
  it("shows the toolbar button only when wired", () => {
    const { rerender } = render(<VaultNavigator {...navProps()} />);
    expect(screen.queryByRole("button", { name: "Graph view" })).toBeNull();
    const onOpenGraph = vi.fn();
    rerender(<VaultNavigator {...navProps({ onOpenGraph })} />);
    fireEvent.click(screen.getByRole("button", { name: "Graph view" }));
    expect(onOpenGraph).toHaveBeenCalledOnce();
  });

  it("offers Open local graph on drawing rows, not folders", () => {
    const onOpenLocalGraph = vi.fn();
    render(<VaultNavigator {...navProps({ onOpenLocalGraph })} />);
    fireEvent.contextMenu(screen.getByText("F"));
    expect(
      screen.queryByRole("menuitem", { name: "Open local graph" }),
    ).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.contextMenu(screen.getByText("a"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open local graph" }));
    expect(onOpenLocalGraph).toHaveBeenCalledWith("a.excalidraw");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("useGraphEntry", () => {
  const setup = (activePath: string | null, openOk = true) => {
    const run = vi.fn(() => true);
    const openDrawing = vi.fn(async () => openOk);
    const hook = renderHook(
      ({ path }) => useGraphEntry(path, openDrawing, run),
      { initialProps: { path: activePath } },
    );
    return { run, openDrawing, hook };
  };

  it("openGraph runs graph.open", () => {
    const { run, hook } = setup(null);
    hook.result.current.openGraph();
    expect(run).toHaveBeenCalledWith(GRAPH_COMMAND_IDS.open);
  });

  it("the active drawing: runs graph.openLocal right away", async () => {
    const { run, openDrawing, hook } = setup("a.excalidraw");
    await act(() => hook.result.current.openLocalGraph("a.excalidraw"));
    expect(openDrawing).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(GRAPH_COMMAND_IDS.openLocal);
  });

  it("another drawing: opens it, then runs graph.openLocal once active", async () => {
    const { run, openDrawing, hook } = setup("a.excalidraw");
    await act(() => hook.result.current.openLocalGraph("b.excalidraw"));
    expect(openDrawing).toHaveBeenCalledWith("b.excalidraw");
    expect(run).not.toHaveBeenCalled();
    hook.rerender({ path: "b.excalidraw" });
    expect(run).toHaveBeenCalledExactlyOnceWith(GRAPH_COMMAND_IDS.openLocal);
    // Later renders don't run it again.
    hook.rerender({ path: "a.excalidraw" });
    hook.rerender({ path: "b.excalidraw" });
    expect(run).toHaveBeenCalledOnce();
  });

  it("drops the request when the open fails", async () => {
    const { run, hook } = setup("a.excalidraw", false);
    await act(() => hook.result.current.openLocalGraph("b.excalidraw"));
    hook.rerender({ path: "b.excalidraw" });
    expect(run).not.toHaveBeenCalled();
  });

  it("drops the request when another drawing becomes active", async () => {
    const { run, hook } = setup("a.excalidraw");
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = hook.result.current.openLocalGraph("b.excalidraw");
    });
    hook.rerender({ path: "c.excalidraw" });
    hook.rerender({ path: "b.excalidraw" });
    await act(() => opening);
    expect(run).not.toHaveBeenCalled();
  });
});
