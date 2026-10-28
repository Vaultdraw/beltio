/**
 * The side panel: the favourites in the user's order. Click or Enter opens one; drag a row,
 * or Alt+Up / Alt+Down, reorders; F2 or double-click renames the label; Delete removes.
 */
import { useRef, useState, useSyncExternalStore } from "react";

import { labelOf, move, relabel, removeAt, type Favourite } from "./model";

import type { FavouritesStore } from "./store";

const dirOf = (path: string) =>
  path.slice(0, Math.max(0, path.lastIndexOf("/")));

export default function FavouritesPanel({
  store,
  open,
}: {
  store: FavouritesStore;
  open: (f: Favourite) => void;
}) {
  const items = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [editing, setEditing] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const rows = useRef<(HTMLElement | null)[]>([]);

  const focusRow = (i: number) => rows.current[i]?.focus();
  const reorder = (from: number, to: number) => {
    void store.update((all) => move(all, from, to));
  };

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (editing !== null) {
      return;
    }
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const to = i + (e.key === "ArrowUp" ? -1 : 1);
      reorder(i, to);
      requestAnimationFrame(() =>
        focusRow(Math.max(0, Math.min(items.length - 1, to))),
      );
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      focusRow(i + (e.key === "ArrowUp" ? -1 : 1));
    } else if (e.key === "F2") {
      e.preventDefault();
      setEditing(i);
    } else if (e.key === "Delete") {
      e.preventDefault();
      void store.update((all) => removeAt(all, i));
      requestAnimationFrame(() => focusRow(Math.min(i, items.length - 2)));
    }
  };

  return (
    <div className="vd-fav" data-testid="favourites-panel">
      <h2 className="vd-fav-title">Favourites</h2>
      {items.length === 0 ? (
        <p className="vd-fav-empty">
          Nothing yet. Right-click a drawing or note and choose "Favourite: add
          or remove", or press Mod+Alt+J in an open drawing.
        </p>
      ) : (
        <ul className="vd-fav-list" aria-label="Favourites">
          {items.map((f, i) => (
            <li
              key={`${f.path}\n${f.element ?? ""}`}
              className="vd-fav-row"
              data-testid="favourite-row"
              data-dragging={drag?.from === i}
              data-over={drag?.over === i && drag.from !== i}
              draggable={editing === null}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setDrag({ from: i, over: i });
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag((d) => (d && d.over !== i ? { ...d, over: i } : d));
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag) {
                  reorder(drag.from, i);
                }
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
            >
              {editing === i ? (
                <input
                  className="vd-fav-rename"
                  aria-label="Favourite label"
                  autoFocus
                  defaultValue={labelOf(f)}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      const v = e.currentTarget.value;
                      setEditing(null);
                      void store.update((all) => relabel(all, i, v));
                      requestAnimationFrame(() => focusRow(i));
                    } else if (e.key === "Escape") {
                      setEditing(null);
                      requestAnimationFrame(() => focusRow(i));
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="vd-fav-open"
                  ref={(el) => {
                    rows.current[i] = el;
                  }}
                  title={f.path}
                  onClick={() => open(f)}
                  onDoubleClick={() => setEditing(i)}
                  onKeyDown={(e) => onKey(e, i)}
                >
                  <span className="vd-fav-label">{labelOf(f)}</span>
                  <span className="vd-fav-path">{dirOf(f.path) || "/"}</span>
                </button>
              )}
              <button
                type="button"
                className="vd-fav-btn"
                aria-label={`Remove ${labelOf(f)} from favourites`}
                title="Remove"
                onClick={() => void store.update((all) => removeAt(all, i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length > 1 ? (
        <p className="vd-fav-hint">
          Drag or Alt+Up / Alt+Down to reorder, F2 to rename, Delete to remove.
        </p>
      ) : null}
    </div>
  );
}
