/**
 * The side panel: the drawing's frames in slide order. Click or Enter zooms to one; drag a row,
 * or Alt+Up / Alt+Down, reorders; F2 or double-click renames; the Present button starts the show
 * from the selected frame.
 */
import { useRef, useState } from "react";

import { labelOf, moveId, type FrameBox } from "./order";
import { rename, saveOrder, slidesOf } from "./store";

import type { PluginContext } from "@vaultdraw/api";

const sameList = (a: readonly FrameBox[], b: readonly FrameBox[]) =>
  a.length === b.length &&
  a.every((f, i) => {
    const g = b[i];
    return (
      f.id === g.id &&
      f.name === g.name &&
      f.x === g.x &&
      f.y === g.y &&
      f.width === g.width &&
      f.height === g.height
    );
  });

export default function FramesPanel({
  ctx,
  present,
}: {
  ctx: PluginContext;
  present: () => void;
}) {
  // The selector reads the saved order too: a reorder changes customData, which bumps the scene.
  const slides = ctx.scene.useScene(() => slidesOf(ctx), sameList);
  const [current, setCurrent] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const rows = useRef<(HTMLElement | null)[]>([]);
  const ids = slides.map((f) => f.id);

  const zoom = (f: FrameBox) => {
    setCurrent(f.id);
    ctx.scene.fitTo(f.id, { padding: 40, select: true });
  };
  const reorder = (from: number, to: number) => {
    const next = moveId(ids, from, to);
    void saveOrder(ctx, next);
  };
  const focusRow = (i: number) =>
    requestAnimationFrame(() =>
      rows.current[Math.max(0, Math.min(ids.length - 1, i))]?.focus(),
    );

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (editing !== null) {
      return;
    }
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const to = i + (e.key === "ArrowUp" ? -1 : 1);
      reorder(i, to);
      focusRow(to);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      focusRow(i + (e.key === "ArrowUp" ? -1 : 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      zoom(slides[i]);
    } else if (e.key === "F2") {
      e.preventDefault();
      setEditing(slides[i].id);
    }
  };

  return (
    <div className="vd-frames" data-testid="frames-panel">
      <div className="vd-frames-head">
        <h2 className="vd-frames-title">Frames</h2>
        <button
          type="button"
          className="vd-frames-present"
          data-testid="frames-present"
          disabled={slides.length === 0}
          onClick={present}
          title="Present from the selected frame"
        >
          Present
        </button>
      </div>
      {slides.length === 0 ? (
        <p className="vd-frames-empty">
          No frames in this drawing. Draw one with the Frame tool (F); each
          frame becomes a slide.
        </p>
      ) : (
        <ol className="vd-frames-list">
          {slides.map((f, i) => (
            <li
              key={f.id}
              className="vd-frames-row"
              data-over={drag?.over === i && drag.from !== i}
              data-dragging={drag?.from === i}
              data-current={current === f.id}
              draggable={editing === null}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setDrag({ from: i, over: i });
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (drag && drag.over !== i) {
                  setDrag({ ...drag, over: i });
                }
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
              <span className="vd-frames-num" aria-hidden="true">
                {i + 1}
              </span>
              {editing === f.id ? (
                <input
                  className="vd-frames-rename"
                  autoFocus
                  defaultValue={f.name ?? ""}
                  placeholder={`Frame ${i + 1}`}
                  aria-label="Frame name"
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    setEditing(null);
                    if ((f.name ?? "") !== e.currentTarget.value.trim()) {
                      void rename(ctx, f.id, e.currentTarget.value);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      e.currentTarget.value = f.name ?? "";
                      e.currentTarget.blur();
                    }
                    e.stopPropagation();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="vd-frames-open"
                  ref={(el) => {
                    rows.current[i] = el;
                  }}
                  onClick={() => zoom(f)}
                  onDoubleClick={() => setEditing(f.id)}
                  onKeyDown={(e) => onKey(e, i)}
                >
                  <span className="vd-frames-label">{labelOf(f, i)}</span>
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="vd-frames-hint">
        Click to zoom, drag or Alt+Up / Alt+Down to reorder, F2 to rename.
      </p>
    </div>
  );
}
