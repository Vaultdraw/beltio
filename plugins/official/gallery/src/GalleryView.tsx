/**
 * Folder gallery: a windowed, keyboard-driven grid of thumbnail tiles (subfolders
 * first). The plugin's overlay (main.tsx) holds the folder state around it.
 */
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { GALLERY_MOVES, galleryCommandId, type GalleryMove } from "./commands";
import { IconDrawing, IconFolder } from "./icons";
import { useViewCommands } from "./useViewCommands";

import {
  computeGridWindow,
  pageRows,
  sameWindow,
  scrollTopToReveal,
  type GridMetrics,
  type GridWindow,
} from "./gridWindow";
import { moveIndex } from "./keyboard";
import { createScrollSettle, type ScrollSettle } from "./scrollSettle";

import type { FolderItem as VaultEntry, PluginContext } from "@vaultdraw/api";

export const TILE_WIDTH = 192;
export const TILE_HEIGHT = 190; // 144 thumbnail + name
export const GAP = 16;
const PADDING = 16;
// jsdom has no layout: fall back to a plausible viewport.
const FALLBACK = { width: 1000, height: 600 };

export interface GalleryViewProps {
  /** The plugin's context: thumbnails and command handlers. */
  ctx: PluginContext;
  /** Folder path ("" = vault root). */
  folder: string;
  vaultName: string;
  /** Already sorted and filtered: subfolders first, then drawings. */
  items: readonly VaultEntry[];
  /** Item to select first (the folder we came from), if present. */
  initialPath?: string | null;
  onOpenDrawing: (path: string) => void;
  onOpenFolder: (path: string) => void;
  onParent: () => void;
  onClose: () => void;
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const stripDrawingExt = (name: string) =>
  name.replace(/\.excalidraw(\.md)?$/i, "");
const displayName = (e: VaultEntry) =>
  e.kind === "folder" ? e.name : stripDrawingExt(baseName(e.path));

const Tile = memo(
  ({
    ctx,
    entry,
    index,
    active,
    deferred,
    onActivate,
  }: {
    ctx: PluginContext;
    entry: VaultEntry;
    index: number;
    active: boolean;
    /** Fast scroll: do not start watching yet (a latch: stays on once started). */
    deferred: boolean;
    onActivate: (index: number) => void;
  }) => {
    const thumbsOn = ctx.thumbnails.useEnabled();
    const isDrawing = entry.kind === "drawing";
    const [started, setStarted] = useState(!deferred);
    if (!started && !deferred) {
      setStarted(true);
    }
    const state = ctx.thumbnails.use(
      thumbsOn && isDrawing && started ? entry.path : null,
      "visible",
    );
    const status = started ? state.status : "loading";
    let media;
    if (isDrawing && state.status === "ready" && state.url) {
      media = (
        <img
          className="vault-thumb vault-thumb--md"
          src={state.url}
          loading="lazy"
          decoding="async"
          draggable={false}
          alt=""
        />
      );
    } else {
      media = (
        <span
          className="vault-thumb vault-thumb--md vault-thumb--placeholder"
          data-state={isDrawing ? status : "folder"}
          aria-hidden="true"
        >
          {isDrawing ? <IconDrawing /> : <IconFolder />}
        </span>
      );
    }
    return (
      <div
        role="gridcell"
        id={`vd-gallery-tile-${index}`}
        className="vd-gallery__tile"
        data-kind={entry.kind}
        aria-selected={active}
        title={entry.path}
        onClick={() => onActivate(index)}
      >
        {media}
        <span className="vd-gallery__name">{displayName(entry)}</span>
      </div>
    );
  },
);
Tile.displayName = "GalleryTile";

export default function GalleryView({
  ctx,
  folder,
  vaultName,
  items,
  initialPath,
  onOpenDrawing,
  onOpenFolder,
  onParent,
  onClose,
}: GalleryViewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const dark = ctx.thumbnails.useDarkClass();
  const [size, setSize] = useState(FALLBACK);
  const [scrollTop, setScrollTop] = useState(0);
  const [flying, setFlying] = useState(false);
  const settle = useRef<ScrollSettle | null>(null);
  useEffect(() => {
    const s = createScrollSettle(setFlying);
    settle.current = s;
    return () => s.dispose();
  }, []);
  const [active, setActive] = useState(() => {
    const i = initialPath ? items.findIndex((e) => e.path === initialPath) : -1;
    return Math.max(0, i);
  });

  const metrics: GridMetrics = {
    viewportWidth: size.width,
    viewportHeight: size.height,
    tileWidth: TILE_WIDTH,
    tileHeight: TILE_HEIGHT,
    gap: GAP,
    count: items.length,
    overscanRows: 1,
  };
  // The window is recomputed per render but its identity only changes when it
  // changes by value, so memoised tiles and children stay put while scrolling
  // within a row.
  const windowRef = useRef<GridWindow | null>(null);
  const next = computeGridWindow(scrollTop, metrics);
  if (!windowRef.current || !sameWindow(windowRef.current, next)) {
    windowRef.current = next;
  }
  const win = windowRef.current;
  const current = Math.min(active, Math.max(0, items.length - 1));

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el || !el.clientWidth) {
      return;
    }
    const width = Math.max(1, el.clientWidth - PADDING * 2);
    const height = el.clientHeight;
    setSize((s) =>
      s.width === width && s.height === height ? s : { width, height },
    );
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => scroller.current?.focus({ preventScroll: true }), []);

  // Keep the active tile in view (also on the first open).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || items.length === 0) {
      return;
    }
    // The grid starts PADDING below the scroller's content top.
    const top =
      scrollTopToReveal(current, el.scrollTop - PADDING, metrics) + PADDING;
    if (top !== el.scrollTop) {
      el.scrollTop = top;
      setScrollTop(top);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, win.columns, size.height]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) {
      settle.current?.note(el.scrollTop, size.height, performance.now());
      setScrollTop(el.scrollTop);
    }
  };

  const activate = useCallback(
    (index: number) => {
      const entry = items[index];
      if (!entry) {
        return;
      }
      if (entry.kind === "folder") {
        onOpenFolder(entry.path);
      } else {
        onOpenDrawing(entry.path);
      }
    },
    [items, onOpenDrawing, onOpenFolder],
  );

  // Mouse: select + open in one click, like the tree.
  const onTileClick = useCallback(
    (index: number) => {
      setActive(index);
      activate(index);
    },
    [activate],
  );

  // gallery.* commands (galleryCommands.ts): bound while the grid is open.
  const actions = useMemo(() => {
    const ctx = {
      index: current,
      count: items.length,
      columns: win.columns,
      pageRows: pageRows(size.height, win.rowHeight),
    };
    const move = (m: GalleryMove) => {
      const index = moveIndex(m, ctx);
      return index === null ? undefined : () => setActive(index);
    };
    return Object.fromEntries([
      ...GALLERY_MOVES.map((m) => [galleryCommandId(m), move(m)]),
      [
        galleryCommandId("open"),
        items.length > 0 ? () => activate(current) : undefined,
      ],
      [galleryCommandId("parent"), onParent],
      [galleryCommandId("close"), onClose],
    ]);
  }, [
    current,
    items.length,
    win.columns,
    win.rowHeight,
    size.height,
    activate,
    onParent,
    onClose,
  ]);
  useViewCommands(scroller, actions);

  const mounted: VaultEntry[] = items.slice(win.first, win.last + 1);
  const rows: { row: number; start: number }[] = [];
  for (let r = win.firstRow; r <= win.lastRow; r++) {
    rows.push({ row: r, start: r * win.columns });
  }
  const activeMounted = current >= win.first && current <= win.last;
  const crumbs = folder ? folder.split("/") : [];

  return (
    <div className="vd-gallery" data-testid="gallery-view">
      <div className="vd-gallery__header">
        <span className="vd-gallery__crumbs">
          <span>{vaultName}</span>
          {crumbs.map((c, i) => (
            <span key={i}>
              <span className="vd-gallery__sep"> / </span>
              {c}
            </span>
          ))}
        </span>
        <span className="vd-gallery__count" data-testid="gallery-count">
          {items.length} {items.length === 1 ? "item" : "items"}
        </span>
      </div>
      <div
        ref={scroller}
        className={`vd-gallery__scroller ${dark}`}
        role="grid"
        data-keyscope="gallery"
        tabIndex={0}
        aria-label={`Gallery: ${folder || vaultName}`}
        aria-rowcount={win.rowCount}
        aria-colcount={win.columns}
        aria-activedescendant={
          activeMounted ? `vd-gallery-tile-${current}` : undefined
        }
        onScroll={onScroll}
      >
        {items.length === 0 ? (
          <div className="vd-gallery__empty">This folder is empty</div>
        ) : (
          <div
            className="vd-gallery__space"
            style={{ height: win.totalHeight }}
          >
            <div
              className="vd-gallery__window"
              style={{
                top: win.firstRow * win.rowHeight,
                gridTemplateColumns: `repeat(${win.columns}, ${TILE_WIDTH}px)`,
                gap: GAP,
              }}
            >
              {rows.map(({ row, start }) => (
                <div
                  key={row}
                  role="row"
                  aria-rowindex={row + 1}
                  className="vd-gallery__row"
                >
                  {mounted
                    .slice(start - win.first, start - win.first + win.columns)
                    .map((entry, i) => (
                      <Tile
                        key={entry.path}
                        ctx={ctx}
                        entry={entry}
                        index={start + i}
                        active={start + i === current}
                        deferred={flying}
                        onActivate={onTileClick}
                      />
                    ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
