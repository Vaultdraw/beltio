import { useEffect, useId, useMemo, useRef, useState } from "react";

import { getBaseName, getParentPath, isMoveAllowed } from "../vault/treeStore";

import { userError } from "./userError";

import { Dialog } from "./Dialog";
import { IconChevronDown, IconChevronRight, IconFolder } from "./Icons";
import { moveRows } from "./moveTree";

import type { KeyboardEvent } from "react";

interface MoveModalProps {
  sourcePath: string;
  sourceKind: "drawing" | "folder";
  folders: string[]; // List of all known folder paths in vault, e.g. ["", "DSA", "DSA/Dynamic Programming"]
  onMove: (destinationParentPath: string) => void | Promise<void>;
  onCancel: () => void;
}

/** Root, and every ancestor of the current location, so it is visible. */
const initialExpanded = (sourcePath: string): Set<string> => {
  const open = new Set<string>([""]);
  let path = getParentPath(sourcePath);
  while (path !== "") {
    open.add(path);
    path = getParentPath(path);
  }
  return open;
};

/**
 * Move dialog: a mini-tree of the vault's folders with a type-ahead filter.
 * Keyboard: type to filter, Up/Down to move, Right/Left to expand/collapse (or
 * step into/out of a folder), Enter to move, Escape to cancel.
 */
export const MoveModal = ({
  sourcePath,
  sourceKind,
  folders,
  onMove,
  onCancel,
}: MoveModalProps) => {
  const [active, setActive] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(() => initialExpanded(sourcePath));
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const rows = useMemo(
    () => moveRows(folders, expanded, query),
    [folders, expanded, query],
  );
  // Filtering can hide the active row: fall back to the first match.
  const activeIndex = Math.max(
    0,
    rows.findIndex((r) => r.entry.path === active),
  );
  const activePath = rows[activeIndex]?.entry.path ?? "";

  useEffect(() => {
    treeRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activePath]);

  const select = (path: string) => {
    setActive(path);
    setError(null);
  };

  const setOpen = (path: string, open: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });

  const confirm = async (target: string) => {
    const check = isMoveAllowed(sourcePath, target);
    if (!check.allowed) {
      setError(check.reason ?? "Invalid move target");
      return;
    }
    setMoving(true);
    setError(null);
    try {
      await onMove(target);
    } catch (err: unknown) {
      setError(userError(err));
      setMoving(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || moving) {
      return;
    }
    const row = rows[activeIndex];
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        select(rows[Math.min(rows.length - 1, activeIndex + 1)].entry.path);
        break;
      case "ArrowUp":
        e.preventDefault();
        select(rows[Math.max(0, activeIndex - 1)].entry.path);
        break;
      case "ArrowRight":
        // With text in the filter the arrows belong to the caret.
        if (query === "" && row) {
          e.preventDefault();
          if (row.hasChildren && !row.expanded) {
            setOpen(row.entry.path, true);
          } else if (row.hasChildren) {
            select(rows[activeIndex + 1].entry.path);
          }
        }
        break;
      case "ArrowLeft":
        if (query === "" && row) {
          e.preventDefault();
          if (row.expanded) {
            setOpen(row.entry.path, false);
          } else if (row.entry.path !== "") {
            select(getParentPath(row.entry.path));
          }
        }
        break;
      case "Enter":
        e.preventDefault();
        if (row) {
          void confirm(row.entry.path);
        }
        break;
    }
  };

  const entryName = getBaseName(sourcePath);
  const destLabel = activePath === "" ? "the vault root" : `/${activePath}`;

  return (
    <Dialog
      title={`Move ${sourceKind === "drawing" ? "Drawing" : "Folder"}`}
      titleId="move-modal-title"
      className="vd-dialog--wide"
      onClose={onCancel}
      busy={moving}
      footer={
        <>
          <button
            type="button"
            className="vault-btn"
            onClick={onCancel}
            disabled={moving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="vault-btn vault-btn--primary"
            onClick={() => void confirm(activePath)}
            disabled={moving}
          >
            {moving ? "Moving..." : "Move Here"}
          </button>
        </>
      }
    >
      <div onKeyDown={onKeyDown}>
        <p className="vd-dialog__lede">
          Choose a destination folder for <strong>{entryName}</strong>. Type to
          filter, arrow keys to navigate, Enter to move.
        </p>
        <input
          ref={inputRef}
          type="text"
          className="vault-input vd-move__filter"
          style={{ marginTop: 12 }}
          placeholder="Filter folders…"
          aria-label="Filter folders"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${baseId}-tree`}
          aria-activedescendant={`${baseId}-${activeIndex}`}
          value={query}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            setError(null);
            // Land on the first folder that itself matches, not its ancestor.
            const first = moveRows(folders, expanded, next).find(
              (r) => r.matches,
            );
            if (next.trim() !== "" && first) {
              setActive(first.entry.path);
            }
          }}
        />
        <div
          ref={treeRef}
          id={`${baseId}-tree`}
          className="vd-move__tree"
          role="tree"
          aria-label="Destination folders"
        >
          {rows.length <= 1 && query.trim() !== "" && (
            <div className="vd-move__empty">No folder matches “{query}”.</div>
          )}
          {rows.map((row, i) => {
            const path = row.entry.path;
            const allowed = isMoveAllowed(sourcePath, path).allowed;
            return (
              <div
                key={path}
                id={`${baseId}-${i}`}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-expanded={row.hasChildren ? row.expanded : undefined}
                aria-selected={i === activeIndex}
                aria-disabled={!allowed}
                className={`vd-move__row${
                  row.matches ? "" : " vd-move__row--context"
                }`}
                style={{ paddingLeft: 4 + row.depth * 16 }}
                onClick={() => select(path)}
                onDoubleClick={() => void confirm(path)}
              >
                <span
                  className="vd-move__chev"
                  onClick={(e) => {
                    if (row.hasChildren) {
                      e.stopPropagation();
                      setOpen(path, !row.expanded);
                    }
                  }}
                >
                  {row.hasChildren &&
                    (row.expanded ? <IconChevronDown /> : <IconChevronRight />)}
                </span>
                <IconFolder />
                <span className="vd-move__name">{row.entry.name}</span>
              </div>
            );
          })}
        </div>
        <div className="vd-move__dest">
          {sourceKind === "drawing" ? "Drawing" : "Folder"} will move into{" "}
          {destLabel}.
        </div>
        {error && (
          <div className="vault-error-text" style={{ marginTop: "8px" }}>
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
};
