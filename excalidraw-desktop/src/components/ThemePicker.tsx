import {
  type KeyboardEvent,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { IconCheck, IconSearch } from "./Icons";
import { Segmented } from "./settings/pages/controls";
import { ThemeHalf } from "./ThemePreviewCard";

import type { ThemeMode } from "../theme";
import type { ThemeEntry } from "../theme/registry";

const PREVIEW_MODES: readonly ThemeMode[] = ["dark", "light"];
const GENERATED_NOTE =
  /^(dark|light): generated from the (dark|light) variant$/;

/** Cards per row; arrow Up/Down move by this many. Mirrors the CSS grid. */
const COLUMNS = 3;
/** Previews are rendered once a card comes this close to the visible area. */
const PREVIEW_MARGIN = "240px 0px";

const entryId = (entry: ThemeEntry) => `${entry.source}:${entry.key}`;

/**
 * Display name. `entry.name` equals `entry.summary.name` but is a plain
 * field, so listing and filtering never build a summary (or parse a theme).
 */
export const themeEntryName = (entry: ThemeEntry): string => entry.name;

/** Case-insensitive substring filter on the theme name. */
export const filterThemes = (
  themes: readonly ThemeEntry[],
  query: string,
): readonly ThemeEntry[] => {
  const q = query.trim().toLocaleLowerCase();
  if (!q) {
    return themes;
  }
  return themes.filter((entry) =>
    themeEntryName(entry).toLocaleLowerCase().includes(q),
  );
};

export type ThemeSide = "all" | "dark" | "light";

/**
 * Sides a theme was written for: a side generated from the other one does
 * not count (a dark-only theme shows under "Dark" only). Reads the entry's
 * cheap summary, so call it only while a Dark/Light filter is on.
 */
export const themeNativeSides = (entry: ThemeEntry): readonly ThemeMode[] => {
  const { generated } = entry.summary.preview;
  const native = PREVIEW_MODES.filter((mode) => !generated[mode]);
  return native.length > 0 ? native : PREVIEW_MODES;
};

/** Themes written for `side` (all of them for "all"). */
export const filterThemeSide = (
  themes: readonly ThemeEntry[],
  side: ThemeSide,
): readonly ThemeEntry[] =>
  side === "all"
    ? themes
    : themes.filter((entry) => themeNativeSides(entry).includes(side));

const SIDE_OPTIONS = [
  { label: "All", val: "all" },
  { label: "Dark", val: "dark" },
  { label: "Light", val: "light" },
] as const;

/**
 * Dark + light preview from the entry's cheap summary (never `entry.theme`,
 * which parses the theme). Rendered only once the card is near view.
 */
const ThemePreview = memo(({ entry }: { entry: ThemeEntry }) => {
  const { preview } = entry.summary;
  return (
    <>
      {PREVIEW_MODES.map((mode) => (
        <ThemeHalf
          key={mode}
          mode={mode}
          colors={preview[mode]}
          generated={preview.generated[mode]}
        />
      ))}
    </>
  );
});
ThemePreview.displayName = "ThemePreview";

interface ThemeCardProps {
  entry: ThemeEntry;
  selected: boolean;
  focusable: boolean;
  showPreview: boolean;
  onPick: (entry: ThemeEntry) => void;
}

const ThemeCard = memo(
  ({ entry, selected, focusable, showPreview, onPick }: ThemeCardProps) => {
    const name = themeEntryName(entry);
    // Built-ins can carry harmless notes; only user files show them.
    // The "auto" badge already says a variant was generated.
    const warnings =
      entry.source === "user"
        ? entry.warnings.filter((w) => !GENERATED_NOTE.test(w))
        : [];
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={name}
        tabIndex={focusable ? 0 : -1}
        data-theme-key={entry.key}
        data-card-id={entryId(entry)}
        className={`vault-theme-card ${
          selected ? "vault-theme-card--selected" : ""
        }`}
        title={entry.path ?? entry.author ?? name}
        onClick={() => onPick(entry)}
      >
        <div className="vault-theme-card__preview" aria-hidden="true">
          {showPreview && <ThemePreview entry={entry} />}
        </div>
        <div className="vault-theme-card__meta">
          <span className="vault-theme-card__name">{name}</span>
          {selected && (
            <IconCheck className="vault-theme-card__check" aria-hidden="true" />
          )}
          {entry.source === "user" && (
            <span className="vault-theme-card__tag">
              {entry.overridesBuiltin ? "Custom override" : "Custom"}
            </span>
          )}
        </div>
        {warnings.length > 0 && (
          <div
            className="vault-theme-card__warning"
            title={warnings.join("\n")}
          >
            {warnings.length === 1
              ? warnings[0]
              : `${warnings[0]} (+${warnings.length - 1} more)`}
          </div>
        )}
      </button>
    );
  },
);
ThemeCard.displayName = "ThemeCard";

export interface ThemePickerProps {
  themes: readonly ThemeEntry[];
  selectedKey: string;
  onSelect: (entry: ThemeEntry) => void;
}

/**
 * Searchable grid of theme cards, each previewing its dark and light
 * variants. The grid shows three rows of three and scrolls inside itself.
 *
 * Cost per render stays flat with 100+ themes: cards and previews are
 * memoised, names come from the entry, and a preview (the only part that
 * reads palette colours) is rendered only once its card scrolls near the
 * visible area.
 */
export const ThemePicker = ({
  themes,
  selectedKey,
  onSelect,
}: ThemePickerProps) => {
  const [query, setQuery] = useState("");
  const [side, setSide] = useState<ThemeSide>("all");
  const deferredQuery = useDeferredValue(query);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridId = useId();

  // Stable callback so memoised cards do not re-render when the parent
  // passes a new onSelect each render.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onPick = useCallback(
    (entry: ThemeEntry) => onSelectRef.current(entry),
    [],
  );

  const visible = useMemo(
    () => filterThemeSide(filterThemes(themes, deferredQuery), side),
    [themes, deferredQuery, side],
  );

  // Cards that have been near the viewport (monotonic). null = no
  // IntersectionObserver available: render every preview.
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(() =>
    typeof IntersectionObserver === "undefined" ? null : new Set(),
  );
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (records) => {
        const ids: string[] = [];
        for (const record of records) {
          if (record.isIntersecting) {
            const id = (record.target as HTMLElement).dataset.cardId;
            if (id) {
              ids.push(id);
            }
            observer.unobserve(record.target);
          }
        }
        if (ids.length) {
          setSeen((prev) => {
            const next = new Set(prev ?? []);
            ids.forEach((id) => next.add(id));
            return next;
          });
        }
      },
      { root, rootMargin: PREVIEW_MARGIN },
    );
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  // (Re)observe cards whose preview is not rendered yet.
  useEffect(() => {
    const observer = observerRef.current;
    const root = scrollRef.current;
    if (!observer || !root) {
      return;
    }
    root
      .querySelectorAll<HTMLElement>(".vault-theme-card[data-card-id]")
      .forEach((card) => {
        if (!seen?.has(card.dataset.cardId!)) {
          observer.observe(card);
        }
      });
  }, [visible, seen]);

  // Bring the selected card into view when the picker opens. Only the grid
  // scrolls; the settings page keeps its position.
  useLayoutEffect(() => {
    const root = scrollRef.current;
    const card = root?.querySelector<HTMLElement>(
      ".vault-theme-card--selected",
    );
    if (!root) {
      return;
    }
    if (card) {
      const top = card.offsetTop;
      const bottom = top + card.offsetHeight;
      if (top < root.scrollTop || bottom > root.scrollTop + root.clientHeight) {
        root.scrollTop = Math.max(
          0,
          top - (root.clientHeight - card.offsetHeight) / 2,
        );
      }
    }
    // Render the previews of the cards in view before the first paint (the
    // observer reports asynchronously, which would flash empty previews).
    if (root.clientHeight > 0) {
      const viewTop = root.scrollTop;
      const viewBottom = viewTop + root.clientHeight;
      const ids: string[] = [];
      root
        .querySelectorAll<HTMLElement>(".vault-theme-card[data-card-id]")
        .forEach((el) => {
          if (
            el.offsetTop < viewBottom &&
            el.offsetTop + el.offsetHeight > viewTop
          ) {
            ids.push(el.dataset.cardId!);
          }
        });
      if (ids.length) {
        setSeen((prev) => (prev ? new Set([...prev, ...ids]) : prev));
      }
    }
    // Only on mount: later selections are made by the user, in view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Roving tab stop: the selected card, else the first visible one.
  const focusKey = visible.some((e) => e.key === selectedKey)
    ? selectedKey
    : visible[0]?.key;

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const cards = Array.from(
      scrollRef.current?.querySelectorAll<HTMLButtonElement>(
        ".vault-theme-card",
      ) ?? [],
    );
    const index = cards.indexOf(
      event.target as HTMLButtonElement & EventTarget,
    );
    if (index < 0) {
      return;
    }
    const last = cards.length - 1;
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    };
    let next: number;
    if (event.key in step) {
      next = Math.min(last, Math.max(0, index + step[event.key]));
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = last;
    } else {
      return;
    }
    event.preventDefault();
    cards[next]?.focus();
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query) {
      // Clear the search instead of closing Settings.
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
    } else if (event.key === "ArrowDown" && visible.length) {
      event.preventDefault();
      scrollRef.current
        ?.querySelector<HTMLButtonElement>('.vault-theme-card[tabindex="0"]')
        ?.focus();
    }
  };

  const filtering = deferredQuery.trim() !== "" || side !== "all";

  return (
    <div className="vault-theme-picker" data-testid="theme-picker">
      <div className="vault-theme-head">
        <span className="vault-theme-head__title">Theme</span>
        <span className="vault-theme-head__note">
          {themes.length} · every theme has a light and dark side
        </span>
        <span className="vault-theme-head__spacer" />
        <div className="vault-theme-search">
          <IconSearch className="vault-theme-search__icon" aria-hidden="true" />
          <input
            type="search"
            className="vault-input vault-theme-search__input"
            placeholder="Search themes"
            aria-label="Search colour themes"
            aria-controls={gridId}
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
        </div>
        <Segmented
          options={SIDE_OPTIONS}
          value={side}
          onChange={setSide}
          label="Show themes written for"
        />
      </div>
      <div
        ref={scrollRef}
        className="vault-theme-scroll"
        data-testid="theme-picker-scroll"
      >
        <div
          id={gridId}
          className="vault-theme-grid"
          role="radiogroup"
          aria-label="Colour theme"
          onKeyDown={handleGridKeyDown}
        >
          {visible.map((entry) => {
            const id = entryId(entry);
            return (
              <ThemeCard
                key={id}
                entry={entry}
                selected={entry.key === selectedKey}
                focusable={entry.key === focusKey}
                showPreview={seen === null || seen.has(id)}
                onPick={onPick}
              />
            );
          })}
        </div>
        {visible.length === 0 && (
          <div className="vault-theme-empty">
            No themes match &ldquo;{deferredQuery.trim()}&rdquo;
          </div>
        )}
      </div>
      <div className="vault-visually-hidden" role="status" aria-live="polite">
        {filtering
          ? `${visible.length} ${visible.length === 1 ? "theme" : "themes"}`
          : ""}
      </div>
    </div>
  );
};
