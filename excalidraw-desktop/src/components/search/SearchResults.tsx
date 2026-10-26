import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { Highlighted } from "../../search/highlight";
import { useVaultSearch } from "../../search/useVaultSearch";
import { getParentPath, searchEntries } from "../../vault/treeStore";
import { useThumbDarkClass } from "../../thumbnails/surfaces/darkInvert";
import { SearchThumb } from "../../thumbnails/surfaces/SearchThumb";
import { isNewTabClick } from "../../tabs/newTabClick";
import { getPreferences } from "../../vault/preferences";
import { IconFolder } from "../Icons";

import "./SearchResults.css";

import { formatCount } from "./formatCount";

import type { RefObject } from "react";

import type { ElementMatch, SearchHit, VaultSearch } from "../../search/types";
import type { OpenTarget } from "../../tabs/types";
import type { VaultEntry } from "../../vault/types";

const MAX_FOLDERS = 5;

export type SearchRow =
  | { kind: "folder"; key: string; entry: VaultEntry }
  | { kind: "drawing"; key: string; hit: SearchHit }
  | { kind: "snippet"; key: string; hit: SearchHit; match: ElementMatch };

interface Props {
  query: string;
  /** The search input keeps focus; this component drives it via key events. */
  inputRef: RefObject<HTMLInputElement | null>;
  search: VaultSearch | null;
  handle: string;
  allIndexedEntries: VaultEntry[];
  activePath: string | null;
  onOpenDrawing: (path: string, opts?: { target: OpenTarget }) => void;
  onOpenMatch: (
    path: string,
    match: ElementMatch,
    opts?: { target: OpenTarget },
  ) => void;
  onOpenFolder: (path: string) => void;
}

const stripExt = (name: string) => name.replace(/\.excalidraw$/i, "");
const fmt = formatCount;

const entryToHit = (entry: VaultEntry): SearchHit => ({
  path: entry.path,
  name: entry.name,
  score: 0,
  nameHighlights: [],
  matches: [],
  matchCount: 0,
});

const DrawingRow = memo(
  ({
    id,
    index,
    hit,
    active,
    current,
    onPick,
  }: {
    id: string;
    index: number;
    hit: SearchHit;
    active: boolean;
    current: boolean;
    onPick: (index: number, newTab?: boolean) => void;
  }) => {
    const parent = getParentPath(hit.path);
    return (
      <div
        id={id}
        role="option"
        aria-selected={active}
        data-kind="drawing"
        data-path={hit.path}
        className={`vault-search-row ${
          active ? "vault-search-row--active" : ""
        } ${current ? "vault-search-row--current" : ""}`}
        onClick={(e) => onPick(index, isNewTabClick(e))}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            onPick(index, true);
          }
        }}
      >
        <SearchThumb path={hit.path} />
        <span className="vault-search-row__name" title={hit.path}>
          <Highlighted text={stripExt(hit.name)} ranges={hit.nameHighlights} />
        </span>
        {parent && <span className="vault-search-row__path">{parent}</span>}
        {hit.matchCount > 0 && (
          <span className="vault-search-row__count">{hit.matchCount}</span>
        )}
      </div>
    );
  },
);

const SnippetRow = memo(
  ({
    id,
    index,
    match,
    active,
    onPick,
  }: {
    id: string;
    index: number;
    match: ElementMatch;
    active: boolean;
    onPick: (index: number, newTab?: boolean) => void;
  }) => {
    return (
      <div
        id={id}
        role="option"
        aria-selected={active}
        data-kind="snippet"
        data-element-id={match.elementId}
        className={`vault-search-row vault-search-row--snippet ${
          active ? "vault-search-row--active" : ""
        }`}
        onClick={(e) => onPick(index, isNewTabClick(e))}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            onPick(index, true);
          }
        }}
      >
        <span className="vault-search-row__snippet">
          <Highlighted text={match.snippet} ranges={match.highlights} />
        </span>
      </div>
    );
  },
);

const FolderRow = memo(
  ({
    id,
    index,
    entry,
    active,
    onPick,
  }: {
    id: string;
    index: number;
    entry: VaultEntry;
    active: boolean;
    onPick: (index: number, newTab?: boolean) => void;
  }) => {
    const parent = getParentPath(entry.path);
    return (
      <div
        id={id}
        role="option"
        aria-selected={active}
        data-kind="folder"
        data-path={entry.path}
        className={`vault-search-row ${
          active ? "vault-search-row--active" : ""
        }`}
        onClick={(e) => onPick(index, isNewTabClick(e))}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            onPick(index, true);
          }
        }}
      >
        <span className="vault-search-row__icon">
          <IconFolder />
        </span>
        <span className="vault-search-row__name" title={entry.path}>
          {entry.name}
        </span>
        {parent && <span className="vault-search-row__path">{parent}</span>}
      </div>
    );
  },
);

export const SearchResults = ({
  query,
  inputRef,
  search,
  handle,
  allIndexedEntries,
  activePath,
  onOpenDrawing,
  onOpenMatch,
  onOpenFolder,
}: Props) => {
  const baseId = useId();
  const thumbDark = useThumbDarkClass();
  const listId = `${baseId}-list`;
  const listRef = useRef<HTMLDivElement>(null);
  // Result counts are config keys (`search.max_drawings`, `search.max_snippets`).
  const { searchMaxDrawings: maxDrawings, searchMaxSnippets: maxSnippets } =
    getPreferences();
  const { response, loading, error } = useVaultSearch(search, handle, query, {
    limit: maxDrawings,
  });

  // In-memory name matching: folders always, drawings when there is no
  // native search (or it failed before producing any result).
  const deferredQuery = useDeferredValue(query);
  const nameMatches = useMemo(
    () => searchEntries(allIndexedEntries, deferredQuery),
    [allIndexedEntries, deferredQuery],
  );
  const useFallback = !search || (!response && error !== null);

  const { rows, drawingTotal } = useMemo(() => {
    const out: SearchRow[] = [];
    const folders = nameMatches
      .filter((e) => e.kind === "folder")
      .slice(0, MAX_FOLDERS);
    for (const entry of folders) {
      out.push({ kind: "folder", key: `f:${entry.path}`, entry });
    }
    let hits: SearchHit[];
    let total: number;
    if (useFallback) {
      const drawings = nameMatches.filter((e) => e.kind === "drawing");
      total = drawings.length;
      hits = drawings.slice(0, maxDrawings).map(entryToHit);
    } else {
      total = response?.totalMatches ?? 0;
      hits = (response?.results ?? []).slice(0, maxDrawings);
    }
    for (const hit of hits) {
      out.push({ kind: "drawing", key: `d:${hit.path}`, hit });
      for (const match of hit.matches.slice(0, maxSnippets)) {
        out.push({
          kind: "snippet",
          key: `s:${hit.path}:${match.elementId}`,
          hit,
          match,
        });
      }
    }
    return { rows: out, drawingTotal: total };
  }, [nameMatches, response, useFallback, maxDrawings, maxSnippets]);

  const [activeIndex, setActiveIndex] = useState(0);
  // New result set: start from the top again.
  useEffect(() => setActiveIndex(0), [rows]);
  const safeIndex =
    rows.length === 0 ? -1 : Math.min(activeIndex, rows.length - 1);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const handlersRef = useRef({ onOpenDrawing, onOpenMatch, onOpenFolder });
  handlersRef.current = { onOpenDrawing, onOpenMatch, onOpenFolder };

  const activate = useCallback((index: number, newTab?: boolean) => {
    const row = rowsRef.current[index];
    if (!row) {
      return;
    }
    const h = handlersRef.current;
    const opts = newTab ? { target: "new" as const } : undefined;
    if (row.kind === "folder") {
      h.onOpenFolder(row.entry.path);
    } else if (row.kind === "drawing") {
      h.onOpenDrawing(row.hit.path, opts);
    } else {
      h.onOpenMatch(row.hit.path, row.match, opts);
    }
  }, []);

  const rowId = (index: number) => `${baseId}-r${index}`;
  const activeId = safeIndex >= 0 ? rowId(safeIndex) : null;

  // The input keeps focus: wire arrows/Enter on it and expose the active row.
  const safeIndexRef = useRef(safeIndex);
  safeIndexRef.current = safeIndex;
  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const count = rowsRef.current.length;
      if (event.isComposing) {
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (count === 0) {
          return;
        }
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((safeIndexRef.current + step + count) % count);
      } else if (event.key === "Enter" && safeIndexRef.current >= 0) {
        event.preventDefault();
        activate(safeIndexRef.current, isNewTabClick(event));
      }
    };
    input.addEventListener("keydown", onKeyDown);
    input.setAttribute("aria-controls", listId);
    return () => {
      input.removeEventListener("keydown", onKeyDown);
      input.removeAttribute("aria-controls");
      input.removeAttribute("aria-activedescendant");
    };
  }, [inputRef, activate, listId]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    if (activeId) {
      input.setAttribute("aria-activedescendant", activeId);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
    listRef.current
      ?.querySelector<HTMLElement>(`[id="${activeId}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeId, inputRef]);

  // Status line
  const state = response?.status.state;
  const indexing =
    !useFallback && response && state && state !== "ready"
      ? `Indexing ${fmt(response.status.indexed)} of ${fmt(
          response.status.total,
        )} drawings…`
      : null;
  let statusText: string;
  if (error && useFallback) {
    statusText = `Content search unavailable (${error}). Showing name matches.`;
  } else if (!useFallback && !response) {
    statusText = loading ? "Searching…" : "";
  } else if (rows.length === 0) {
    statusText = "No matches";
  } else if (drawingTotal === 0) {
    statusText = "";
  } else {
    const shown = Math.min(drawingTotal, maxDrawings);
    statusText =
      drawingTotal > shown
        ? `${fmt(shown)} of ${fmt(drawingTotal)} drawings`
        : `${fmt(drawingTotal)} ${drawingTotal === 1 ? "drawing" : "drawings"}`;
  }
  if (indexing) {
    statusText = rows.length === 0 ? indexing : `${statusText} · ${indexing}`;
  }

  return (
    <div className="vault-search-results">
      <div
        className={`vault-search-status ${
          error && useFallback ? "vault-search-status--error" : ""
        }`}
        role="status"
        aria-live="polite"
      >
        {statusText}
      </div>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Search results"
        className={`vault-search-list${thumbDark ? ` ${thumbDark}` : ""}`}
      >
        {rows.map((row, index) => {
          const id = rowId(index);
          const active = index === safeIndex;
          const label =
            row.kind === "folder" && index === 0 ? (
              <div
                key="folders-label"
                role="presentation"
                className="vault-search-group-label"
              >
                Folders
              </div>
            ) : null;
          let node: React.ReactNode;
          if (row.kind === "folder") {
            node = (
              <FolderRow
                key={row.key}
                id={id}
                index={index}
                entry={row.entry}
                active={active}
                onPick={activate}
              />
            );
          } else if (row.kind === "drawing") {
            node = (
              <DrawingRow
                key={row.key}
                id={id}
                index={index}
                hit={row.hit}
                active={active}
                current={row.hit.path === activePath}
                onPick={activate}
              />
            );
          } else {
            node = (
              <SnippetRow
                key={row.key}
                id={id}
                index={index}
                match={row.match}
                active={active}
                onPick={activate}
              />
            );
          }
          return label ? [label, node] : node;
        })}
      </div>
    </div>
  );
};
