import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, fireEvent, render, screen } from "@testing-library/react";

import { installListKeysForTests } from "../../commands/listKeysForTests";
import { ThumbnailProvider } from "../context";

import GalleryView from "./GalleryView";
import { SETTLE_MS } from "./scrollSettle";

import type { ThumbnailService } from "../service";

import type { VaultEntry } from "../../vault/types";

const entries = (folders: number, drawings: number): VaultEntry[] => [
  ...Array.from({ length: folders }, (_, i) => ({
    path: `sub${i}`,
    name: `sub${i}`,
    kind: "folder" as const,
    modifiedAt: 0,
    size: 0,
  })),
  ...Array.from({ length: drawings }, (_, i) => ({
    path: `d${i}.excalidraw`,
    name: `d${i}.excalidraw`,
    kind: "drawing" as const,
    modifiedAt: 0,
    size: 0,
  })),
];

const setup = (items: VaultEntry[], folder = "") => {
  const h = {
    onOpenDrawing: vi.fn(),
    onOpenFolder: vi.fn(),
    onParent: vi.fn(),
    onClose: vi.fn(),
  };
  render(<GalleryView folder={folder} vaultName="V" items={items} {...h} />);
  return { ...h, grid: screen.getByRole("grid") };
};

let uninstall: () => void;
beforeEach(() => {
  uninstall = installListKeysForTests();
});
afterEach(() => uninstall());

describe("<GalleryView>", () => {
  it("mounts only the window for 5k items", () => {
    setup(entries(2, 5000));
    const cells = screen.getAllByRole("gridcell");
    expect(cells.length).toBeLessThanOrEqual(120);
    expect(cells.length).toBeGreaterThan(0);
    expect(screen.getByTestId("gallery-count").textContent).toBe("5002 items");
  });

  it("is focused, has an active descendant and moves it with keys", () => {
    const { grid } = setup(entries(1, 5));
    expect(document.activeElement).toBe(grid);
    expect(grid.getAttribute("aria-activedescendant")).toBe(
      "vd-gallery-tile-0",
    );
    fireEvent.keyDown(grid, { key: "l" });
    expect(grid.getAttribute("aria-activedescendant")).toBe(
      "vd-gallery-tile-1",
    );
  });

  it("Enter opens a drawing, or enters a folder", () => {
    const { grid, onOpenDrawing, onOpenFolder } = setup(entries(1, 3));
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onOpenFolder).toHaveBeenCalledWith("sub0");
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onOpenDrawing).toHaveBeenCalledWith("d0.excalidraw");
  });

  it("Backspace goes to the parent, Escape closes, click opens", () => {
    const { grid, onParent, onClose, onOpenDrawing } = setup(
      entries(0, 3),
      "a",
    );
    fireEvent.keyDown(grid, { key: "Backspace" });
    expect(onParent).toHaveBeenCalled();
    fireEvent.keyDown(grid, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("gridcell")[2]);
    expect(onOpenDrawing).toHaveBeenCalledWith("d2.excalidraw");
  });

  it("keys act only while the grid has focus", () => {
    const { grid, onClose } = setup(entries(1, 3));
    (document.activeElement as HTMLElement).blur();
    document.body.focus();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    grid.focus();
    fireEvent.keyDown(grid, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("without a thumbnail service tiles show placeholders and no img", () => {
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

    it("tiles mounted during a fast scroll watch only once it settles", () => {
      vi.useFakeTimers();
      let now = 1000;
      vi.spyOn(performance, "now").mockImplementation(() => now);
      const watch = vi.fn(() => () => {});
      const service = { watch } as unknown as ThumbnailService;
      const h = {
        onOpenDrawing: vi.fn(),
        onOpenFolder: vi.fn(),
        onParent: vi.fn(),
        onClose: vi.fn(),
      };
      render(
        <ThumbnailProvider service={service}>
          <GalleryView
            folder=""
            vaultName="V"
            items={entries(0, 5000)}
            {...h}
          />
        </ThumbnailProvider>,
      );
      const grid = screen.getByRole("grid");
      const scrollTo = (top: number) => {
        now += 16;
        grid.scrollTop = top;
        fireEvent.scroll(grid);
      };
      const initial = watch.mock.calls.length;
      expect(initial).toBeGreaterThan(0); // the first window watches at once
      scrollTo(1); // the detector needs a first sample

      scrollTo(20_000);
      scrollTo(40_000);
      scrollTo(60_000);
      expect(watch.mock.calls.length).toBe(initial); // flew by: no watches

      act(() => {
        vi.advanceTimersByTime(SETTLE_MS);
      });
      const watched = new Set(watch.mock.calls.map((c) => (c as any)[0]));
      expect(watch.mock.calls.length).toBeGreaterThan(initial);
      // Only the tiles around the settle point, not the ones passed on the way.
      expect(watch.mock.calls.length - initial).toBeLessThan(100);
      expect(watched.size).toBe(watch.mock.calls.length);
    });
  });
});
