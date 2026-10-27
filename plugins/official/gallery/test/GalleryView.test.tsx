import { afterEach, describe, expect, it, vi } from "vitest";

import { act, fireEvent, render, screen } from "@testing-library/react";

import GalleryView from "../src/GalleryView";
import { SETTLE_MS } from "../src/scrollSettle";
import { runGridCommand } from "../src/useViewCommands";

import type { FolderItem as VaultEntry, PluginContext } from "@vaultdraw/api";

/** Only what the view uses: thumbnails (off, or a watcher spy). */
const fakeCtx = (use?: (path: string | null) => void): PluginContext =>
  ({
    thumbnails: {
      use: (path: string | null) => {
        use?.(path);
        return { status: "none", url: null };
      },
      useEnabled: () => true,
      useDarkClass: () => "",
    },
  } as unknown as PluginContext);

const entries = (folders: number, drawings: number): VaultEntry[] => [
  ...Array.from({ length: folders }, (_, i) => ({
    path: `sub${i}`,
    name: `sub${i}`,
    kind: "folder" as const,
  })),
  ...Array.from({ length: drawings }, (_, i) => ({
    path: `d${i}.excalidraw`,
    name: `d${i}.excalidraw`,
    kind: "drawing" as const,
  })),
];

const setup = (items: VaultEntry[], folder = "", ctx = fakeCtx()) => {
  const h = {
    onOpenDrawing: vi.fn(),
    onOpenFolder: vi.fn(),
    onParent: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <GalleryView
      ctx={ctx}
      folder={folder}
      vaultName="V"
      items={items}
      {...h}
    />,
  );
  return { ...h, grid: screen.getByRole("grid") };
};

describe("<GalleryView>", () => {
  it("mounts only the window for 5k items", () => {
    setup(entries(2, 5000));
    const cells = screen.getAllByRole("gridcell");
    expect(cells.length).toBeLessThanOrEqual(120);
    expect(cells.length).toBeGreaterThan(0);
    expect(screen.getByTestId("gallery-count").textContent).toBe("5002 items");
  });

  it("is focused, has an active descendant and moves it with its commands", () => {
    const { grid } = setup(entries(1, 5));
    expect(document.activeElement).toBe(grid);
    expect(grid.getAttribute("aria-activedescendant")).toBe(
      "vd-gallery-tile-0",
    );
    act(() => runGridCommand("right"));
    expect(grid.getAttribute("aria-activedescendant")).toBe(
      "vd-gallery-tile-1",
    );
  });

  it("open opens a drawing, or enters a folder", () => {
    const { onOpenDrawing, onOpenFolder } = setup(entries(1, 3));
    act(() => runGridCommand("open"));
    expect(onOpenFolder).toHaveBeenCalledWith("sub0");
    act(() => runGridCommand("right"));
    act(() => runGridCommand("open"));
    expect(onOpenDrawing).toHaveBeenCalledWith("d0.excalidraw");
  });

  it("parent and close run, a click opens", () => {
    const { onParent, onClose, onOpenDrawing } = setup(entries(0, 3), "a");
    act(() => runGridCommand("parent"));
    expect(onParent).toHaveBeenCalled();
    act(() => runGridCommand("close"));
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("gridcell")[2]);
    expect(onOpenDrawing).toHaveBeenCalledWith("d2.excalidraw");
  });

  it("commands do nothing once the grid is unmounted", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <GalleryView
        ctx={fakeCtx()}
        folder=""
        vaultName="V"
        items={entries(0, 2)}
        onOpenDrawing={vi.fn()}
        onOpenFolder={vi.fn()}
        onParent={vi.fn()}
        onClose={onClose}
      />,
    );
    unmount();
    runGridCommand("close");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("with thumbnails off tiles show placeholders and no img", () => {
    setup(entries(1, 3));
    expect(document.querySelectorAll("img").length).toBe(0);
    expect(document.querySelectorAll(".vault-thumb--placeholder").length).toBe(
      4,
    );
  });

  describe("fast scroll", () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("tiles mounted during a fast scroll start thumbnails only once it settles", () => {
      vi.useFakeTimers();
      let now = 1000;
      vi.spyOn(performance, "now").mockImplementation(() => now);
      const asked = new Set<string>();
      const { grid } = setup(
        entries(0, 5000),
        "",
        fakeCtx((p) => p && asked.add(p)),
      );
      const scrollTo = (top: number) => {
        now += 16;
        grid.scrollTop = top;
        fireEvent.scroll(grid);
      };
      const initial = asked.size;
      expect(initial).toBeGreaterThan(0); // the first window starts at once
      scrollTo(1); // the detector needs a first sample

      scrollTo(20_000);
      scrollTo(40_000);
      scrollTo(60_000);
      expect(asked.size).toBe(initial); // flew by: none started

      act(() => {
        vi.advanceTimersByTime(SETTLE_MS);
      });
      expect(asked.size).toBeGreaterThan(initial);
      // Only the tiles around the settle point, not the ones passed on the way.
      expect(asked.size - initial).toBeLessThan(100);
    });
  });
});
