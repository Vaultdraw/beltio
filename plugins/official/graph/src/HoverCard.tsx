import { count } from "../../../../sdk/api/shared/plural";

import type { ShownNode } from "./GraphSession";

export interface HoverCardProps {
  shown: ShownNode;
  /** Bound `drawing.open:<path>` hotkey label, if any. */
  shortcut: string | null;
  /** Hint letters of the node when it is on screen. */
  hint: string | null;
  /** Stage size, to keep the card inside it. */
  width: number;
  height: number;
}

const CARD_W = 240;
const CARD_H = 150;
const GAP = 14;

export function cardPosition(
  x: number,
  y: number,
  width: number,
  height: number,
): { left: number; top: number } {
  let left = x + GAP;
  let top = y + GAP;
  if (left + CARD_W > width) {
    left = Math.max(4, x - GAP - CARD_W);
  }
  if (top + CARD_H > height) {
    top = Math.max(4, y - GAP - CARD_H);
  }
  return { left, top };
}

export function HoverCard({
  shown,
  shortcut,
  hint,
  width,
  height,
}: HoverCardProps) {
  const { info } = shown;
  const pos = cardPosition(shown.x, shown.y, width, height);
  return (
    <div
      className="vd-graph__card"
      role="status"
      style={{ left: pos.left, top: pos.top }}
      data-testid="graph-card"
    >
      <div className="vd-graph__card-name">{info.name}</div>
      <div className="vd-graph__card-meta">
        {info.kind === "ghost"
          ? "Unresolved link"
          : info.kind === "tag"
          ? "Tag"
          : info.folder || "Vault root"}
      </div>
      {info.tags.length > 0 && (
        <div className="vd-graph__card-tags">{info.tags.join(" ")}</div>
      )}
      <div className="vd-graph__card-meta">
        {info.kind === "drawing"
          ? `${count(info.links, "link")} · ${count(
              info.backlinks,
              "backlink",
            )}`
          : count(info.links, "link")}
      </div>
      <div className="vd-graph__card-keys">
        {info.kind === "drawing" ? "↵ open · L local graph" : "L local graph"}
        {shortcut && <span> · {shortcut}</span>}
        {hint && <span> · hint {hint}</span>}
      </div>
    </div>
  );
}
