/**
 * The palette, one component with two modes (VS Code style). Files mode
 * (Cmd+P) lists drawings by name; commands mode (Cmd+Shift+P, shown as a
 * leading ">") lists provider items (commands, editor actions, themes, pens,
 * library items...). Typing ">" switches to commands, deleting it switches
 * back; the same mode's shortcut closes, the other mode's switches. Tab
 * drills into an item's family ("Theme: "). Items are collected the first
 * time commands mode shows (and again after a Mod+Enter run); everything is
 * prepared once and ranked synchronously per keystroke (see palette/rank.ts).
 */
import {
  Fragment,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { stripDrawingExt } from "../vault/fileKind";

import { chordFromEvent } from "../commands/keys";
import {
  getCommand,
  PALETTE_COMMANDS_ID,
  PALETTE_FILES_ID,
} from "../commands/commands";
import { effectiveKeys } from "../commands/keymap";
import { useHotkeyOverrides } from "../commands/useCommands";
import { focusCanvasIfIdle } from "../palette/focus";
import {
  COMMANDS_PREFIX,
  modeOf,
  prepareDrawings,
  prepareItems,
  rankRows,
  warmDrawings,
} from "../palette/rank";
import { rowHeadings, withCreateRow } from "../palette/group";
import { namesCache } from "../palette/namesCache";
import { getRecent, recordRecent } from "../palette/recent";
import { PalettePreview } from "../thumbnails/surfaces/PalettePreview";
import { errorMessage } from "../vault/types";

import {
  IconDrawing,
  IconKeyDown,
  IconKeyReturn,
  IconKeyUp,
  IconPlus,
} from "./Icons";

import "./home.css";
import "./QuickSwitcher.css";

import type { Names } from "../palette/namesCache";
import type { OpenTarget } from "../tabs/types";
import type { DrawingIndex, PaletteMode, RankedRow } from "../palette/rank";
import type { PaletteItem } from "../palette/types";
import type { Platform } from "../commands/types";
import type { VaultSearch } from "../search/types";

const MODE_COMMANDS: Record<PaletteMode, string> = {
  files: PALETTE_FILES_ID,
  commands: PALETTE_COMMANDS_ID,
};
const MODE_TEXT: Record<
  PaletteMode,
  { label: string; chip: string; placeholder: string; hint: string }
> = {
  files: {
    label: "Go to drawing",
    chip: "Drawings",
    placeholder: "Search drawings by name  (> for commands)",
    hint: "",
  },
  commands: {
    label: "Run a command",
    chip: "Commands",
    placeholder: "",
    hint: " Search commands  (delete > for drawings)",
  },
};
const NO_ITEMS: readonly PaletteItem[] = [];
const DRILL_SEPARATOR = ": ";
/** Rows painted before the rest of the (capped) result list is added. */
const FIRST_ROWS = 24;

export interface QuickSwitcherProps {
  /** Source of the drawing names; null = use `fallbackPaths`. */
  search: Pick<VaultSearch, "listNames" | "subscribe"> | null;
  handle: string;
  /** Mode to open in (default files); the palette switches itself after. */
  initialMode?: PaletteMode;
  /** Used when there is no search backend. */
  fallbackPaths?: readonly string[];
  /** Entries from the palette providers (collectPaletteItems); called when commands mode first shows and again after a Mod+Enter run. */
  collectItems(): readonly PaletteItem[];
  platform: Platform;
  /** Mod+Enter on a drawing asks for a new tab. */
  onOpenDrawing(path: string, opts?: { target: OpenTarget }): void;
  /** Creates an empty drawing with this name (the "Create" row); omitted = no Create row. */
  onCreateDrawing?(name: string): void;
  /** Pick mode: a drawing row calls `onOpenDrawing` as usual, but commands are not offered; the label replaces the placeholder. */
  pickLabel?: string;
  /** Enter: the shell closes the palette, then runs it. Mod+Enter (keepOpen): the shell runs it in place. */
  onRunItem(item: PaletteItem, keepOpen: boolean): void;
  /** Esc, backdrop click, or the current mode's own shortcut. */
  onClose(): void;
  ownerDocument?: Document | null;
}

/** Wrap matched characters of text[from, to) in <mark>. */
function highlight(
  text: string,
  from: number,
  to: number,
  positions: ReadonlySet<number>,
) {
  if (positions.size === 0) {
    return text.slice(from, to);
  }
  const out: React.ReactNode[] = [];
  let i = from;
  while (i < to) {
    const marked = positions.has(i);
    let j = i + 1;
    while (j < to && positions.has(j) === marked) {
      j++;
    }
    const part = text.slice(i, j);
    out.push(marked ? <mark key={i}>{part}</mark> : part);
    i = j;
  }
  return out;
}

interface RowViewProps {
  id: string;
  row: RankedRow;
  active: boolean;
  index: number;
  onHover(index: number): void;
  onPick(index: number): void;
}

const RowView = memo(
  ({ id, row, active, index, onHover, onPick }: RowViewProps) => {
    const positions = new Set(row.positions);
    let body: React.ReactNode;
    if (row.kind === "drawing") {
      const { path } = row.drawing;
      const slash = path.lastIndexOf("/");
      const nameEnd = stripDrawingExt(path).length;
      body = (
        <>
          <span className="vault-quick__icon">
            <IconDrawing />
          </span>
          <span className="vault-quick__name">
            {highlight(path, slash + 1, nameEnd, positions)}
          </span>
          {slash > 0 && (
            <span className="vault-quick__muted">
              {highlight(path, 0, slash, positions)}
            </span>
          )}
        </>
      );
    } else if (row.kind === "create") {
      body = (
        <>
          <span className="vault-quick__icon">
            <IconPlus />
          </span>
          <span className="vault-quick__name">Create “{row.name}”</span>
        </>
      );
    } else {
      const { item } = row.entry;
      body = (
        <>
          <span className="vault-quick__icon">{item.icon}</span>
          <span className="vault-quick__name">
            {highlight(item.title, 0, item.title.length, positions)}
          </span>
          <span className="vault-quick__muted">{item.group}</span>
          {item.family && (
            <span className="vault-quick__tab">
              <kbd className="vault-kbd">Tab</kbd> browse
            </span>
          )}
          {item.checked && (
            <span
              className="vault-quick__check"
              role="img"
              aria-label="Current"
            >
              ✓
            </span>
          )}
          {item.shortcut && (
            <kbd className="vault-kbd vault-quick__keys">{item.shortcut}</kbd>
          )}
        </>
      );
    }
    return (
      <div
        id={id}
        role="option"
        aria-selected={active}
        data-open-path={row.kind === "drawing" ? row.drawing.path : undefined}
        className={`vault-quick__row${
          active ? " vault-quick__row--active" : ""
        }`}
        onMouseMove={() => onHover(index)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPick(index)}
      >
        {body}
      </div>
    );
  },
);
RowView.displayName = "RowView";

/** Last drawing index, so unchanged paths keep their prepared form. */
let lastIndex: DrawingIndex | null = null;

function useDrawingNames(
  search: QuickSwitcherProps["search"],
  handle: string,
  fallbackPaths: readonly string[] | undefined,
): Names {
  const [names, setNames] = useState<Names>(
    () =>
      (search && namesCache.get(handle)) || {
        paths: fallbackPaths ?? [],
        status: null,
        error: null,
      },
  );
  useEffect(() => {
    if (!search) {
      setNames({ paths: fallbackPaths ?? [], status: null, error: null });
      return;
    }
    let disposed = false;
    let generation = 0;
    let knownTotal = -1;
    const load = () => {
      const mine = ++generation;
      search
        .listNames(handle)
        .then((listing) => {
          if (disposed || mine !== generation) {
            return;
          }
          knownTotal = listing.status.total;
          const next = {
            paths: listing.paths,
            status: listing.status,
            error: null,
          };
          namesCache.set(handle, next);
          setNames(next);
        })
        .catch((err) => {
          if (!disposed && mine === generation) {
            setNames((prev) => ({ ...prev, error: errorMessage(err) }));
          }
        });
    };
    load();
    let unsubscribe: (() => void) | undefined;
    search
      .subscribe((status) => {
        if (disposed || status.handle !== handle) {
          return;
        }
        setNames((prev) => (prev.error ? prev : { ...prev, status }));
        if (status.total !== knownTotal) {
          load();
        }
      })
      .then((off) => {
        if (disposed) {
          off();
        } else {
          unsubscribe = off;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unsubscribe?.();
    };
    // fallbackPaths intentionally not a dependency when a backend exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, handle, search ? null : fallbackPaths]);
  return names;
}

/** Query that drills into the family of an item, or null when it has none. */
function drillQuery(item: PaletteItem): string | null {
  const drill =
    item.drill ??
    (item.title.includes(DRILL_SEPARATOR)
      ? item.title.slice(
          0,
          item.title.indexOf(DRILL_SEPARATOR) + DRILL_SEPARATOR.length,
        )
      : null);
  return drill ? `${COMMANDS_PREFIX}${drill}` : null;
}

export const QuickSwitcher = ({
  search,
  handle,
  initialMode = "files",
  fallbackPaths,
  collectItems,
  platform,
  onOpenDrawing,
  pickLabel,
  onCreateDrawing,
  onRunItem,
  onClose,
  ownerDocument,
}: QuickSwitcherProps) => {
  const win = ownerDocument?.defaultView ?? null;
  const [query, setQuery] = useState(
    initialMode === "commands" ? COMMANDS_PREFIX : "",
  );
  const mode = modeOf(query);
  const [active, setActive] = useState(0);
  // null until commands mode first shows: files mode never pays for it.
  const [items, setItems] = useState<readonly PaletteItem[] | null>(() =>
    initialMode === "commands" ? collectItems() : null,
  );
  const recent = useMemo(() => getRecent(mode, win), [mode, win]);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const pendingKey = useRef<string | null>(null);
  const previousFocus = useRef<Element | null>(
    ownerDocument?.activeElement ?? null,
  );
  const overrides = useHotkeyOverrides(win);
  const names = useDrawingNames(search, handle, fallbackPaths);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const drawings = useMemo(() => {
    lastIndex = prepareDrawings(names.paths, lastIndex);
    return lastIndex;
  }, [names.paths]);
  useEffect(() => warmDrawings(drawings), [drawings]);
  const prepared = useMemo(() => prepareItems(items ?? NO_ITEMS), [items]);
  const canCreate = !!onCreateDrawing && !pickLabel;
  const rows = useMemo(
    () =>
      withCreateRow(
        rankRows(drawings, prepared, query, recent),
        query,
        mode,
        canCreate,
      ),
    [drawings, prepared, query, recent, mode, canCreate],
  );
  const headings = useMemo(
    () => rowHeadings(rows, mode, query.trim() !== ""),
    [rows, mode, query],
  );
  const selected = Math.min(active, Math.max(0, rows.length - 1));
  // First paint shows FIRST_ROWS rows; the rest follows in a transition.
  const [shown, setShown] = useState(FIRST_ROWS);
  const rendered = Math.min(rows.length, Math.max(shown, selected + 1));
  useEffect(() => {
    if (rendered >= rows.length) {
      return;
    }
    const timer = setTimeout(
      () => startTransition(() => setShown(rows.length)),
      0,
    );
    return () => clearTimeout(timer);
  }, [rendered, rows]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[aria-selected="true"]`);
    (el as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
  }, [selected, rows]);

  // After a Mod+Enter re-collect, keep the active row if it still exists.
  useEffect(() => {
    const key = pendingKey.current;
    if (key !== null) {
      pendingKey.current = null;
      const at = rows.findIndex((r) => r.key === key);
      if (at >= 0) {
        setActive(at);
      }
    }
  }, [rows]);

  const dismiss = useCallback(() => {
    const prev = previousFocus.current as HTMLElement | null;
    if (prev && prev !== ownerDocument?.body && prev.isConnected) {
      prev.focus?.();
    } else {
      inputRef.current?.blur();
      focusCanvasIfIdle(ownerDocument);
    }
    onClose();
  }, [onClose, ownerDocument]);

  const changeQuery = (next: string) => {
    if (pickLabel && modeOf(next) === "commands") {
      return;
    }
    setQuery(next);
    setActive(0);
    setShown(FIRST_ROWS);
    if (items === null && modeOf(next) === "commands") {
      setItems(collectItems());
    }
  };

  const pick = (index: number, keepOpen = false) => {
    const row = rows[index];
    if (!row) {
      return;
    }
    if (row.kind === "drawing") {
      recordRecent(row.key, win);
      if (keepOpen) {
        onOpenDrawing(row.drawing.path, { target: "new" });
      } else {
        onOpenDrawing(row.drawing.path);
      }
      return;
    }
    if (row.kind === "create") {
      onCreateDrawing?.(row.name);
      return;
    }
    const { item } = row.entry;
    if (item.family) {
      drill();
      return;
    }
    recordRecent(row.key, win);
    onRunItem(item, keepOpen);
    if (keepOpen) {
      pendingKey.current = row.key;
      setTimeout(() => {
        if (!mounted.current) {
          return;
        }
        setItems(collectItems());
        if (ownerDocument?.activeElement !== inputRef.current) {
          onClose();
        }
      }, 0);
    }
  };

  const pickRef = useRef(pick);
  pickRef.current = pick;
  const onPick = useCallback((index: number) => pickRef.current(index), []);

  const drill = () => {
    const row = rows[selected];
    const next = row?.kind === "item" ? drillQuery(row.entry.item) : null;
    if (next !== null) {
      changeQuery(next);
    }
  };

  /** The mode whose palette shortcut `chord` is (files wins a tie). */
  const shortcutMode = (chord: string): PaletteMode | null => {
    for (const target of ["files", "commands"] as const) {
      const command = getCommand(MODE_COMMANDS[target]);
      if (
        command &&
        effectiveKeys(command, overrides, platform).includes(chord)
      ) {
        return target;
      }
    }
    return null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) {
      return;
    }
    const swallow = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const el = inputRef.current;
    const atEnd =
      !!el &&
      el.selectionStart === el.value.length &&
      el.selectionEnd === el.value.length;
    const step = (to: number) => {
      swallow();
      if (rows.length > 0) {
        setActive(to);
      }
    };
    if (e.key === "Escape") {
      swallow();
      dismiss();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      step(
        (selected + (e.key === "ArrowDown" ? 1 : -1) + rows.length) %
          rows.length,
      );
    } else if (e.key === "PageDown" || e.key === "PageUp") {
      const to = selected + (e.key === "PageDown" ? 8 : -8);
      step(Math.max(0, Math.min(rows.length - 1, to)));
    } else if (e.key === "Enter") {
      swallow();
      pick(selected, platform === "mac" ? e.metaKey : e.ctrlKey);
    } else if (e.key === "Tab") {
      swallow();
      if (!e.shiftKey) {
        drill();
      }
    } else if (
      e.key === "ArrowRight" &&
      atEnd &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey
    ) {
      swallow();
      drill();
    } else {
      const chord = chordFromEvent(e.nativeEvent, platform);
      const target = chord ? shortcutMode(chord) : null;
      if (target === mode) {
        swallow();
        dismiss();
      } else if (target) {
        swallow();
        changeQuery(target === "commands" ? COMMANDS_PREFIX : "");
      }
    }
  };

  const indexing =
    names.status && names.status.state !== "ready"
      ? `Indexing… ${names.status.indexed}/${names.status.total}`
      : null;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div
      className="vault-modal-backdrop vault-quick-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          dismiss();
        }
      }}
      onKeyDown={onKeyDown}
    >
      <div
        className="vault-modal vault-quick"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="vault-quick__bar">
          {query === COMMANDS_PREFIX && (
            <span className="vault-quick__hint" aria-hidden="true">
              <span className="vault-quick__hint-prefix">
                {COMMANDS_PREFIX}
              </span>
              {MODE_TEXT.commands.hint}
            </span>
          )}
          <input
            ref={inputRef}
            className="vault-quick__input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={rows.length ? optionId(selected) : undefined}
            aria-label={pickLabel ?? MODE_TEXT[mode].label}
            placeholder={pickLabel ?? MODE_TEXT[mode].placeholder}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
          />
          <span className="vault-quick__mode">
            {pickLabel ? "Pick" : MODE_TEXT[mode].chip}
          </span>
        </div>
        <div
          id={listId}
          ref={listRef}
          className="vault-quick__list"
          role="listbox"
          aria-label="Results"
        >
          {rows.slice(0, rendered).map((row, i) => (
            <Fragment key={row.key}>
              {headings[i] && (
                <div className="vault-quick__group" role="presentation">
                  {headings[i]}
                </div>
              )}
              <RowView
                id={optionId(i)}
                row={row}
                index={i}
                active={i === selected}
                onHover={setActive}
                onPick={onPick}
              />
            </Fragment>
          ))}
        </div>
        {rows.length === 0 && (
          <div className="vault-quick__empty">No matches</div>
        )}
        {names.error && (
          <div className="vault-quick__empty" role="status">
            Could not list drawings: {names.error}
          </div>
        )}
        {indexing && (
          <div className="vault-quick__empty" role="status">
            {indexing}
          </div>
        )}
        <div className="vault-quick__footer" aria-hidden="true">
          <span>
            <kbd className="vault-kbd vault-kbd--glyphs">
              <IconKeyUp />
              <IconKeyDown />
            </kbd>{" "}
            navigate
          </span>
          <span>
            <kbd className="vault-kbd vault-kbd--glyphs">
              <IconKeyReturn />
            </kbd>{" "}
            {mode === "commands" ? "run" : "open"}
          </span>
          {mode === "commands" && (
            <span>
              <kbd className="vault-kbd">Tab</kbd> browse
            </span>
          )}
          <span>
            <kbd className="vault-kbd">esc</kbd> close
          </span>
        </div>
      </div>
      <PalettePreview
        path={
          mode === "files" && rows[selected]?.kind === "drawing"
            ? rows[selected].drawing.path
            : null
        }
      />
    </div>
  );
};

export default QuickSwitcher;
