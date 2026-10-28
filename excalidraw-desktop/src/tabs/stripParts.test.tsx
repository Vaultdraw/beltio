import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MissingTabPlaceholder } from "./MissingTabPlaceholder";
import { TabContextMenu } from "./TabContextMenu";
import { TabListPopover } from "./TabListPopover";
import { createStripSignals } from "./stripSignals";
import { dropIndex } from "./useStripDrag";

describe("dropIndex", () => {
  const mids = [10, 30, 50, 70];
  it("counts the other tabs left of the pointer", () => {
    expect(dropIndex(mids, 0, 1)).toBe(0);
    expect(dropIndex(mids, 45, 0)).toBe(1);
    expect(dropIndex(mids, 100, 0)).toBe(3);
    expect(dropIndex(mids, 31, 1)).toBe(1);
  });
  it("clamps to the group", () => {
    expect(dropIndex(mids, 100, 0, 0, 1)).toBe(1);
    expect(dropIndex(mids, 0, 3, 2, 3)).toBe(2);
  });
});

describe("stripSignals", () => {
  it("emits to subscribers until unsubscribed", () => {
    const s = createStripSignals();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.emit("showAll");
    off();
    s.emit("focus");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("showAll");
  });
});

describe("TabContextMenu", () => {
  const all = {
    onClose: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseRight: vi.fn(),
    onCloseAll: vi.fn(),
    onTogglePin: vi.fn(),
    onCopyPath: vi.fn(),
    onReveal: vi.fn(),
  };
  const open = (
    props = {},
    tab: { id: string; path: string | null; pinned: boolean } = {
      id: "t3",
      path: "a.excalidraw",
      pinned: false,
    },
  ) => {
    const onDismiss = vi.fn();
    render(
      <TabContextMenu
        tab={tab}
        x={5}
        y={5}
        onDismiss={onDismiss}
        {...all}
        {...props}
      />,
    );
    return onDismiss;
  };

  it("fires callbacks with the tab id and dismisses", () => {
    const onDismiss = open();
    expect(screen.getByRole("menu")).toBeTruthy();
    for (const [a, fn] of [
      ["close", all.onClose],
      ["closeOthers", all.onCloseOthers],
      ["closeRight", all.onCloseRight],
      ["pin", all.onTogglePin],
      ["copyPath", all.onCopyPath],
      ["reveal", all.onReveal],
    ] as const) {
      fireEvent.click(screen.getByTestId(`vault-tab-menu-${a}`));
      expect(fn).toHaveBeenLastCalledWith("t3");
    }
    fireEvent.click(screen.getByTestId("vault-tab-menu-closeAll"));
    expect(all.onCloseAll).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledWith(false);
  });

  it("new window is disabled", () => {
    open();
    const item = screen.getByTestId("vault-tab-menu-newWindow");
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.title).toBe("Coming later");
    const onDismiss = vi.fn();
    fireEvent.click(item);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("hides absent callbacks and per-drawing items on home tabs; labels Unpin", () => {
    open(
      { onCloseAll: undefined, onReveal: undefined },
      { id: "t1", path: null, pinned: true },
    );
    expect(screen.queryByTestId("vault-tab-menu-closeAll")).toBeNull();
    expect(screen.queryByTestId("vault-tab-menu-reveal")).toBeNull();
    expect(screen.queryByTestId("vault-tab-menu-copyPath")).toBeNull();
    expect(screen.getByTestId("vault-tab-menu-pin").textContent).toBe("Unpin");
  });

  it("keyboard: focuses first item, arrows wrap, Escape restores focus", () => {
    const onDismiss = open();
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document, { key: "End" });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledWith(true);
  });

  it("click outside dismisses", () => {
    const onDismiss = open();
    fireEvent.pointerDown(document.body);
    expect(onDismiss).toHaveBeenCalledWith(false);
  });
});

describe("TabListPopover", () => {
  const entries = [
    {
      id: "t1",
      label: "alpha",
      path: "alpha.excalidraw",
      pinned: true,
      missing: false,
    },
    {
      id: "t2",
      label: "beta",
      path: "dir/beta.excalidraw",
      pinned: false,
      missing: true,
    },
    {
      id: "t3",
      label: "gamma",
      path: "gamma.excalidraw",
      pinned: false,
      missing: false,
    },
  ];
  const open = () => {
    const onActivate = vi.fn();
    const onDismiss = vi.fn();
    render(
      <TabListPopover
        entries={entries}
        activeId="t3"
        onActivate={onActivate}
        onDismiss={onDismiss}
      />,
    );
    return { onActivate, onDismiss };
  };

  it("lists all tabs with state; cursor starts on the active tab", () => {
    open();
    const rows = screen.getAllByTestId("vault-tab-list-item");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("pinned");
    expect(rows[1].textContent).toContain("missing");
    expect(rows[2].dataset.active).toBe("true");
    expect(rows[2].getAttribute("aria-selected")).toBe("true");
  });

  it("filters fuzzily and Enter activates the top match", () => {
    const { onActivate, onDismiss } = open();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "bet" } });
    expect(screen.getAllByTestId("vault-tab-list-item")).toHaveLength(1);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledWith("t2");
    expect(onDismiss).toHaveBeenCalledWith(true);
  });

  it("arrows move the cursor, click activates, Escape closes", () => {
    const { onActivate, onDismiss } = open();
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onActivate).toHaveBeenLastCalledWith("t1");
    fireEvent.click(screen.getAllByTestId("vault-tab-list-item")[1]);
    expect(onActivate).toHaveBeenLastCalledWith("t2");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onDismiss).toHaveBeenLastCalledWith(true);
  });

  it("click outside closes without restoring focus", () => {
    const { onDismiss } = open();
    fireEvent.pointerDown(document.body);
    expect(onDismiss).toHaveBeenCalledWith(false);
  });
});

describe("MissingTabPlaceholder", () => {
  it("shows the path and fires both actions", () => {
    const onClose = vi.fn();
    const onSearch = vi.fn();
    render(
      <MissingTabPlaceholder
        path="A/x.excalidraw"
        onClose={onClose}
        onSearch={onSearch}
      />,
    );
    expect(screen.getByTestId("missing-tab-placeholder").textContent).toContain(
      "This drawing was moved or deleted outside Vaultdraw",
    );
    expect(screen.getByTitle("A/x.excalidraw")).toBeTruthy();
    fireEvent.click(screen.getByText("Close tab"));
    fireEvent.click(screen.getByText("Search for it"));
    expect(onClose).toHaveBeenCalled();
    expect(onSearch).toHaveBeenCalled();
    void act;
  });
});
