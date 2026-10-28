/** Tabs: filterable list of every open tab (overflow chevron / count chip / tabs.showAll). */

import { useEffect, useMemo, useRef, useState } from "react";

import { filter, prepare } from "../commands/fuzzy";

import type { TabId } from "./types";

export interface TabListEntry {
  id: TabId;
  label: string;
  path: string | null;
  pinned: boolean;
  missing: boolean;
}

export interface TabListPopoverProps {
  entries: readonly TabListEntry[];
  activeId: TabId;
  onActivate: (id: TabId) => void;
  /** `restoreFocus`: closed with Escape or after a pick. */
  onDismiss: (restoreFocus: boolean) => void;
}

export const TabListPopover = ({
  entries,
  activeId,
  onActivate,
  onDismiss,
}: TabListPopoverProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      entries.findIndex((e) => e.id === activeId),
    ),
  );
  const prepared = useMemo(
    () => entries.map((e) => ({ e, p: prepare(e.path ?? e.label) })),
    [entries],
  );
  const rows = useMemo(
    () =>
      filter(prepared, query, (x) => x.p, prepared.length).map((r) => r.item.e),
    [prepared, query],
  );
  const at = Math.min(cursor, rows.length - 1);

  useEffect(() => {
    const doc = rootRef.current?.ownerDocument;
    if (!doc) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        onDismiss(false);
      }
    };
    doc.addEventListener("pointerdown", onPointerDown, true);
    return () => doc.removeEventListener("pointerdown", onPointerDown, true);
  }, [onDismiss]);

  useEffect(() => {
    rootRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [at]);

  const pick = (entry: TabListEntry | undefined) => {
    if (entry) {
      onActivate(entry.id);
      onDismiss(true);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = rows.length;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        return setCursor(n ? (at + 1) % n : 0);
      case "ArrowUp":
        e.preventDefault();
        return setCursor(n ? (at - 1 + n) % n : 0);
      case "Enter":
        e.preventDefault();
        return pick(rows[at]);
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        return onDismiss(true);
    }
  };

  return (
    <div
      ref={rootRef}
      className="vault-tablist"
      data-testid="vault-tab-list"
      onKeyDown={onKeyDown}
    >
      <input
        className="vault-tablist__input"
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls="vault-tablist-box"
        aria-activedescendant={
          rows[at] ? `vault-tablist-${rows[at].id}` : undefined
        }
        aria-label="Filter open tabs"
        placeholder="Filter open tabs"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setCursor(0);
        }}
      />
      <div
        id="vault-tablist-box"
        className="vault-tablist__rows"
        role="listbox"
        aria-label="Open tabs"
      >
        {rows.map((entry, i) => (
          <div
            key={entry.id}
            id={`vault-tablist-${entry.id}`}
            role="option"
            aria-selected={i === at}
            className={[
              "vd-row vault-tablist__row",
              i === at && "vault-tablist__row--cursor",
              entry.id === activeId && "vault-tablist__row--active",
              entry.missing && "vault-tablist__row--missing",
            ]
              .filter(Boolean)
              .join(" ")}
            data-testid="vault-tab-list-item"
            data-tab-id={entry.id}
            data-active={entry.id === activeId ? "true" : "false"}
            title={entry.path ?? entry.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(entry)}
          >
            <span className="vault-tablist__name">{entry.label}</span>
            {entry.pinned && <span className="vault-tablist__tag">pinned</span>}
            {entry.missing && (
              <span className="vault-tablist__tag">missing</span>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="vault-tablist__empty">No matching tabs</div>
        )}
      </div>
    </div>
  );
};
