/**
 * The Tags pane: nested tag list with counts. Click or Enter applies the
 * `tag:#key` filter. Keyboard (Vim style, list focused, all `list.*`
 * commands): j/k or arrows move, h/l collapse/expand, Enter/Space filter,
 * g/G first/last, r or F2 rename, Escape leaves. Above VIRTUALIZE_ABOVE visible rows only a window of rows is
 * in the DOM. Sort, open/closed and collapsed nodes persist per vault.
 */
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { useListKeys } from "../../commands/useListKeys";
import { flattenTree, buildTagTree, type TagRow } from "../../tags/tagTree";
import {
  registerTagSectionToggle,
  registerTagSortToggle,
} from "../../tags/tagActions";
import { loadPaneState, savePaneState } from "../../tags/tagPaneState";
import {
  DEFAULT_TAGS_SETTINGS,
  tagQuery,
  type TagCount,
  type TagSort,
} from "../../tags/types";

import {
  IconChevronDown,
  IconChevronRight,
  IconMore,
  IconSort,
} from "../Icons";

import "./TagsPanel.css";

import type { CSSProperties, Ref } from "react";

import type { ListController } from "../../commands/listNav";

export const ROW_HEIGHT = 22;
export const VIRTUALIZE_ABOVE = 500;
const OVERSCAN = 10;
/** Viewport height assumed before the list is measured. */
const FALLBACK_VIEWPORT = 300;

export type TagsPanelHandle = { focus(): void };

interface TagsPanelProps {
  tags: readonly TagCount[];
  /** Current navigator search query; the tag whose query equals it is active. */
  query: string;
  onQueryChange: (query: string) => void;
  /** Keys the per-vault UI state (the vault's path); without it nothing persists. */
  vaultKey?: string;
  /** Order when the vault has no saved choice (`tags.pane_sort`). */
  defaultSort?: TagSort;
  /** Ask to rename a tag (key, display); the rename row action and r/F2 call it. */
  onRenameTag?: (key: string, display: string) => void;
  /** Escape in the list: hand focus back to the tree/search. */
  onExit?: () => void;
  ref?: Ref<TagsPanelHandle>;
}

const countLabel = (count: number) =>
  `${count} ${count === 1 ? "drawing" : "drawings"}`;

const rowId = (listId: string, key: string) => `${listId}:${key}`;

/** Windowed slice of `total` rows for a scroll position. */
export function windowRange(
  total: number,
  scrollTop: number,
  viewport: number,
): [number, number] {
  if (total <= VIRTUALIZE_ABOVE) {
    return [0, total];
  }
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN;
  return [Math.min(first, total), Math.min(total, last)];
}

/** Collapsible nested tag list; renders nothing when the vault has no tags. */
export const TagsPanel = ({
  tags,
  query,
  onQueryChange,
  vaultKey,
  defaultSort = DEFAULT_TAGS_SETTINGS.paneSort,
  onRenameTag,
  onExit,
  ref,
}: TagsPanelProps) => {
  const [saved] = useState(() => (vaultKey ? loadPaneState(vaultKey) : {}));
  const [open, setOpen] = useState(saved.open ?? true);
  const [sortChoice, setSortChoice] = useState<TagSort | undefined>(saved.sort);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(saved.collapsed),
  );
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [focusNonce, setFocusNonce] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useRef(
    `tags-${Math.random().toString(36).slice(2, 8)}`,
  ).current;

  const sort = sortChoice ?? defaultSort;
  const tree = useMemo(() => buildTagTree(tags, sort), [tags, sort]);
  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);

  const persist = useCallback(
    (patch: Parameters<typeof savePaneState>[1]) => {
      if (vaultKey) {
        savePaneState(vaultKey, patch);
      }
    },
    [vaultKey],
  );

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        setOpen(true);
        setFocusNonce((n) => n + 1);
      },
    }),
    [],
  );
  useEffect(() => {
    if (focusNonce > 0) {
      listRef.current?.focus();
    }
  }, [focusNonce, open]);

  const cursorIndex = Math.max(
    0,
    rows.findIndex((r) => r.node.key === cursorKey),
  );
  const cursorRow: TagRow | undefined = rows[cursorIndex];

  // Keep a row visible (windowed rows are positioned by index).
  const reveal = (index: number) => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const top = index * ROW_HEIGHT;
    const view = list.clientHeight || FALLBACK_VIEWPORT;
    if (top < list.scrollTop) {
      list.scrollTop = top;
    } else if (top + ROW_HEIGHT > list.scrollTop + view) {
      list.scrollTop = top + ROW_HEIGHT - view;
    }
  };
  // Only a cursor move scrolls; typing in the search must not.
  useEffect(() => {
    if (cursorRow) {
      reveal(cursorIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorIndex]);

  // The "Tags: Toggle sort" command flips the order through the latest closure.
  const toggleSortRef = useRef(() => {});
  toggleSortRef.current = () => {
    const next: TagSort = sort === "name" ? "count" : "name";
    setSortChoice(next);
    persist({ sort: next });
  };
  useEffect(() => registerTagSortToggle(() => toggleSortRef.current()), []);
  // command audit (S8): "Tags: Collapse or expand the tags section" flips it through the latest closure.
  const toggleSectionRef = useRef(() => {});
  toggleSectionRef.current = () => toggleSection();
  useEffect(
    () => registerTagSectionToggle(() => toggleSectionRef.current()),
    [],
  );

  const setNodeOpen = (key: string, wantOpen: boolean) =>
    setCollapsed((prev) => {
      if (prev.has(key) === !wantOpen) {
        return prev;
      }
      const next = new Set(prev);
      if (wantOpen) {
        next.delete(key);
      } else {
        next.add(key);
      }
      persist({ collapsed: [...next] });
      return next;
    });

  const toggleSort = () => {
    const next: TagSort = sort === "name" ? "count" : "name";
    setSortChoice(next);
    persist({ sort: next });
  };

  const toggleSection = () => {
    setOpen(!open);
    persist({ open: !open });
  };

  const applyFilter = (key: string) =>
    onQueryChange(query.trim() === tagQuery(key) ? "" : tagQuery(key));

  const move = (index: number) => {
    const row = rows[Math.min(rows.length - 1, Math.max(0, index))];
    if (row) {
      setCursorKey(row.node.key);
      reveal(rows.indexOf(row));
    }
  };

  // Keys are `list.*` commands (j/k/h/l, g/G, Enter, r/F2, Escape by default).
  const row = cursorRow;
  const filterRow = () => {
    if (row) {
      applyFilter(row.node.key);
    }
  };
  const keys: ListController = {
    down: () => move(cursorIndex + 1),
    up: () => move(cursorIndex - 1),
    first: () => move(0),
    last: () => move(rows.length - 1),
    collapse: () => {
      if (row?.isOpen) {
        setNodeOpen(row.node.key, false);
      } else if (row?.parent) {
        setCursorKey(row.parent);
      }
    },
    expand: () => {
      if (row?.hasChildren) {
        if (row.isOpen) {
          move(cursorIndex + 1);
        } else {
          setNodeOpen(row.node.key, true);
        }
      }
    },
    open: filterRow,
    select: filterRow,
    rename: onRenameTag
      ? () => {
          if (row) {
            onRenameTag(row.node.key, row.node.display);
          }
        }
      : undefined,
    exit: () => onExit?.(),
  };
  useListKeys(listRef, "tags", open && tags.length > 0 ? keys : null);

  if (tags.length === 0) {
    return null;
  }

  const total = rows.length;
  const [from, to] = windowRange(
    total,
    scrollTop,
    listRef.current?.clientHeight || FALLBACK_VIEWPORT,
  );
  const virtual = total > VIRTUALIZE_ABOVE;
  const nextSort = sort === "name" ? "count" : "name";

  return (
    <section className="vault-tags" aria-label="Tags">
      <div className="vault-tags__head">
        <button
          type="button"
          className="vault-tags__header"
          aria-expanded={open}
          onClick={toggleSection}
        >
          {open ? <IconChevronDown /> : <IconChevronRight />}
          <span>Tags</span>
        </button>
        {open && (
          <button
            type="button"
            className="vault-tags__sort"
            aria-label={`Sort tags by ${nextSort}`}
            title={`Sorted by ${sort}; click to sort by ${nextSort}`}
            onClick={toggleSort}
          >
            <IconSort />
          </button>
        )}
      </div>
      {open && (
        <div
          ref={listRef}
          className="vault-tags__list"
          role="tree"
          aria-label="Tag list"
          tabIndex={0}
          aria-activedescendant={
            cursorRow ? rowId(listId, cursorRow.node.key) : undefined
          }
          onScroll={
            virtual ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined
          }
        >
          {virtual && <div style={{ height: from * ROW_HEIGHT }} aria-hidden />}
          {rows.slice(from, to).map((row) => {
            const { node } = row;
            const q = tagQuery(node.key);
            const isActive = query.trim() === q;
            const isCursor = cursorRow === row;
            return (
              <div
                key={node.key}
                id={rowId(listId, node.key)}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={isCursor}
                aria-expanded={row.hasChildren ? row.isOpen : undefined}
                className={`vault-tags__row${
                  isActive ? " vault-tags__row--active" : ""
                }${isCursor ? " vault-tags__row--cursor" : ""}`}
                style={{ "--depth": row.depth } as CSSProperties}
              >
                {row.hasChildren ? (
                  <button
                    type="button"
                    className="vault-tags__toggle"
                    tabIndex={-1}
                    aria-expanded={row.isOpen}
                    aria-label={`${row.isOpen ? "Collapse" : "Expand"} ${
                      node.display
                    }`}
                    onClick={() => setNodeOpen(node.key, !row.isOpen)}
                  >
                    {row.isOpen ? <IconChevronDown /> : <IconChevronRight />}
                  </button>
                ) : (
                  <span className="vault-tags__toggle" aria-hidden="true" />
                )}
                <button
                  type="button"
                  className="vault-tags__tag"
                  tabIndex={-1}
                  aria-pressed={isActive}
                  aria-label={`Tag ${node.display}, ${countLabel(node.count)}`}
                  title={q}
                  onClick={() => {
                    setCursorKey(node.key);
                    applyFilter(node.key);
                  }}
                >
                  <span className="vault-tags__label">#{node.label}</span>
                  <span className="vault-tags__count">{node.count}</span>
                </button>
                {onRenameTag && (
                  <button
                    type="button"
                    className="vault-tags__more"
                    tabIndex={-1}
                    aria-label={`Rename tag ${node.display}…`}
                    title="Rename tag… (r)"
                    onClick={() => onRenameTag(node.key, node.display)}
                  >
                    <IconMore />
                  </button>
                )}
              </div>
            );
          })}
          {virtual && (
            <div style={{ height: (total - to) * ROW_HEIGHT }} aria-hidden />
          )}
        </div>
      )}
    </section>
  );
};
