import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getInstallBackend } from "../theme/install/backends";
import {
  consentText,
  grantThemeConsent,
  hasThemeConsent,
} from "../theme/install/consent";
import { kibToBytes } from "../theme/install/installer";
import { toInstallError } from "../theme/install/types";
import { getCatalogueBackend } from "../theme/catalogue/backends";
import {
  MAX_PREVIEW_BYTES,
  createLimiter,
  entryStatus,
  entryUrl,
  imageMime,
  installEntry,
  loadCatalogue,
} from "../theme/catalogue/client";
import {
  NO_FILTERS,
  filterEntries,
  tagCounts,
} from "../theme/catalogue/search";

import { reloadThemeRegistry } from "../theme/registry";
import { getPreferences, updatePreferences } from "../vault/preferences";

import {
  THEME_BROWSER_COMMAND_IDS,
  THEME_BROWSER_CONTEXT_KEY,
} from "../commands/themeCommands";
import { getCommand } from "../commands/commands";
import { defineContextKey } from "../commands/contextKeys";
import { registerCommandHandlers } from "../commands/handlerRegistry";
import { chordFromEvent, detectPlatform } from "../commands/keys";
import { effectiveKeys } from "../commands/keymap";
import { useHotkeyOverrides } from "../commands/useCommands";
import { useCommandShortcutLookup } from "../commands/useCommandShortcut";

import { ExternalLink } from "../help/ExternalLink";

import { Dialog } from "./Dialog";
import { PalettePreview } from "./ThemePreviewCard";

import "./themeBrowser.css";

import type { Filters } from "../theme/catalogue/search";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { InstallBackend, InstalledTheme } from "../theme/install/types";
import type {
  CatalogueBackend,
  CatalogueEntry,
  EntryStatus,
  LoadedCatalogue,
} from "../theme/catalogue/types";

const B = THEME_BROWSER_COMMAND_IDS;

/** Cards drawn at once; a longer result asks for a narrower search. */
const MAX_CARDS = 300;

/** Dialog keys that still work from the search box (plain keys are text there). */
const SEARCH_BOX_COMMANDS: ReadonlySet<string> = new Set([
  THEME_BROWSER_COMMAND_IDS.next,
  THEME_BROWSER_COMMAND_IDS.prev,
  THEME_BROWSER_COMMAND_IDS.down,
  THEME_BROWSER_COMMAND_IDS.up,
  THEME_BROWSER_COMMAND_IDS.activate,
]);
const PREVIEW_PARALLEL = 4;

/** "Dark and light variants" repeats the mode badge; not worth a line. */
const GENERIC_DESC = /^(dark|light)( and (dark|light))? variants?\.?$/i;

type Phase =
  | { k: "consent" }
  | { k: "loading" }
  | { k: "ready" }
  | { k: "error"; message: string };

interface Props {
  /** Fetch the list even when the cached one is fresh. */
  refresh?: boolean;
  onClose: () => void;
  /** Called after "Use" changed the selected theme (re-reads appearance). */
  onThemeChanged?: () => void;
  win?: Window;
}

const ago = (seconds: number): string => {
  const hours = Math.floor((Date.now() / 1000 - seconds) / 3600);
  if (hours < 1) {
    return "just now";
  }
  return hours < 48 ? `${hours} h ago` : `${Math.floor(hours / 24)} days ago`;
};

const ACTION_LABEL: Record<EntryStatus, string> = {
  available: "Install",
  update: "Update",
  installed: "Use",
};

/** The preview image, fetched once the card is on screen (never before). */
const Preview = ({
  entry,
  load,
}: {
  entry: CatalogueEntry;
  load: ((entry: CatalogueEntry) => Promise<string | null>) | null;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (
      !node ||
      !load ||
      entry.previews.length === 0 ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    let live = true;
    let url: string | null = null;
    const observer = new IntersectionObserver((seen) => {
      if (!seen.some((s) => s.isIntersecting)) {
        return;
      }
      observer.disconnect();
      void load(entry).then((made) => {
        if (live && made) {
          url = made;
          setSrc(made);
        } else if (made) {
          URL.revokeObjectURL(made);
        }
      });
    });
    observer.observe(node);
    return () => {
      live = false;
      observer.disconnect();
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [entry, load]);
  return (
    <div ref={ref} className="vault-tb__preview">
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <PalettePreview entry={entry} />
      )}
    </div>
  );
};

export const ThemeBrowserDialog = ({
  refresh = false,
  onClose,
  onThemeChanged,
  win = window,
}: Props) => {
  const prefs = getPreferences(win);
  const [phase, setPhase] = useState<Phase>(
    hasThemeConsent(win) ? { k: "loading" } : { k: "consent" },
  );
  const [loaded, setLoaded] = useState<LoadedCatalogue | null>(null);
  const [installed, setInstalled] = useState<InstalledTheme[]>([]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  const catalogueRef = useRef<CatalogueBackend | null>(null);
  const installRef = useRef<InstallBackend | null>(null);
  const limiter = useRef(createLimiter(PREVIEW_PARALLEL));
  const forceNext = useRef(refresh);

  const catalogueBackend = async () =>
    (catalogueRef.current ??= await getCatalogueBackend(win));
  const installBackend = async () =>
    (installRef.current ??= await getInstallBackend(win));

  const open = useCallback(async () => {
    setPhase({ k: "loading" });
    setError(null);
    try {
      const p = getPreferences(win);
      const [list, mine] = await Promise.all([
        catalogueBackend().then((b) =>
          loadCatalogue(b, {
            url: p.themesIndexUrl,
            ttlHours: p.themesIndexTtlHours,
            force: forceNext.current,
          }),
        ),
        installBackend().then((b) => b.installed()),
      ]);
      forceNext.current = false;
      setLoaded(list);
      setInstalled(mine);
      setPhase({ k: "ready" });
    } catch (err) {
      const e = toInstallError(err);
      if (e.code === "NETWORK_NOT_ALLOWED" || e.code === "NETWORK_DISABLED") {
        setPhase({ k: "consent" });
      } else {
        setPhase({ k: "error", message: e.message });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win]);

  const started = useRef(false);
  useEffect(() => {
    if (!started.current && phase.k === "loading") {
      started.current = true;
      void open();
    }
  }, [phase.k, open]);

  useEffect(() => {
    if (phase.k === "ready") {
      search.current?.focus();
    }
  }, [phase.k]);

  const entries = loaded?.catalogue.entries;
  const shown = useMemo(
    () => (entries ? filterEntries(entries, filters) : []),
    [entries, filters],
  );
  const cards = shown.slice(0, MAX_CARDS);
  const tags = useMemo(() => (entries ? tagCounts(entries) : []), [entries]);
  const current = cards.find((e) => e.name === selected) ?? cards[0] ?? null;

  const loadPreview = useMemo(() => {
    if (!prefs.themesPreviews || !loaded) {
      return null;
    }
    const indexUrl = loaded.catalogue.url;
    return async (entry: CatalogueEntry): Promise<string | null> => {
      try {
        const b = await catalogueBackend();
        const bytes = await limiter.current(() =>
          b.preview(entryUrl(indexUrl, entry.previews[0]), MAX_PREVIEW_BYTES),
        );
        return URL.createObjectURL(
          new Blob([bytes as BlobPart], { type: imageMime(bytes) }),
        );
      } catch {
        return null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, prefs.themesPreviews]);

  const statusOf = (e: CatalogueEntry) => entryStatus(e, installed);

  const run = async (entry: CatalogueEntry, work: () => Promise<string>) => {
    setBusy(entry.name);
    setError(null);
    setMessage(null);
    try {
      setMessage(await work());
    } catch (err) {
      setError(toInstallError(err).message);
    } finally {
      setBusy(null);
    }
  };

  const reloadInstalled = async () => {
    await reloadThemeRegistry(win);
    setInstalled(await (await installBackend()).installed());
  };

  const install = (entry: CatalogueEntry, replace: boolean) =>
    run(entry, async () => {
      const name = await installEntry(
        await installBackend(),
        entry,
        loaded!.catalogue.url,
        kibToBytes(getPreferences(win).themeInstallMaxKb),
        { replace },
      );
      await reloadInstalled();
      return replace ? `Updated ${name}` : `Installed ${name}`;
    });

  const remove = (entry: CatalogueEntry) =>
    run(entry, async () => {
      await (await installBackend()).uninstall(entry.name);
      await reloadInstalled();
      return `Removed ${entry.name}`;
    });

  const act = (entry: CatalogueEntry) => {
    if (busy) {
      return;
    }
    const status = statusOf(entry);
    if (status === "installed") {
      updatePreferences({ colorTheme: entry.name }, win);
      onThemeChanged?.();
      onClose();
    } else {
      void install(entry, status === "update");
    }
  };

  const move = (delta: number) => {
    if (cards.length === 0) {
      return;
    }
    const at = Math.max(
      0,
      cards.findIndex((e) => e === current),
    );
    const next = cards[Math.min(cards.length - 1, Math.max(0, at + delta))];
    setSelected(next.name);
  };

  /** Cards per row, read from the layout (a single row when nothing is laid out). */
  const columns = () => {
    const items = Array.from(grid.current?.children ?? []) as HTMLElement[];
    if (items.length === 0) {
      return 1;
    }
    const top = items[0].offsetTop;
    const first = items.findIndex((el) => el.offsetTop !== top);
    return first === -1 ? items.length : first;
  };

  const shortcut = useCommandShortcutLookup(win);
  const key = (id: string) => shortcut(id) || "(unbound)";
  const focusSearch = () => search.current?.focus();
  const removeCurrent = () => {
    if (current && statusOf(current) !== "available" && !busy) {
      void remove(current);
    }
  };
  /** Enter on a focused button presses that button; otherwise it acts on the card. */
  const activate = () => {
    const el = win.document.activeElement;
    if (el instanceof HTMLButtonElement) {
      el.click();
    } else if (current) {
      act(current);
    }
  };

  const actions: Record<string, () => void> = {
    [B.next]: () => move(1),
    [B.prev]: () => move(-1),
    [B.down]: () => move(columns()),
    [B.up]: () => move(-columns()),
    [B.activate]: activate,
    [B.remove]: removeCurrent,
    [B.search]: focusSearch,
    [B.close]: () => onClose(),
  };
  const live = useRef(actions);
  live.current = actions;

  // The browser's keys are ordinary commands: palette, [hotkeys], rebindable.
  useEffect(() => {
    const handlers: Record<string, () => void> = {};
    for (const id of Object.values(B)) {
      handlers[id] = () => live.current[id]();
    }
    const unbind = registerCommandHandlers(handlers);
    const undefine = defineContextKey(THEME_BROWSER_CONTEXT_KEY, () => true);
    return () => {
      unbind();
      undefine();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The window dispatcher skips plain keys while a text field has focus, so
  // the search box resolves them here from the same (rebindable) keymap.
  const overrides = useHotkeyOverrides(win);
  const platform = useMemo(() => detectPlatform(win), [win]);
  const keyToCommand = useMemo(() => {
    const map = new Map<string, string>();
    for (const id of Object.values(B)) {
      const command = getCommand(id);
      if (command) {
        for (const chord of effectiveKeys(command, overrides, platform)) {
          map.set(chord, id);
        }
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides, platform]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.defaultPrevented) {
      return;
    }
    const target = e.target as HTMLElement;
    if (target.tagName === "SELECT" || target !== search.current) {
      return;
    }
    const chord = chordFromEvent(e.nativeEvent, platform);
    const id = chord && keyToCommand.get(chord);
    // In the search box plain keys are text, except the ones that move or open
    // a card; removing needs Shift (Shift+Delete) so Delete still edits.
    if (
      id &&
      (SEARCH_BOX_COMMANDS.has(id) ||
        (id === B.remove && chord.includes("Shift")))
    ) {
      e.preventDefault();
      live.current[id]();
    }
  };

  const currentName = current?.name;
  useEffect(() => {
    if (currentName === undefined) {
      return;
    }
    const el = grid.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    el?.scrollIntoView?.({ block: "nearest" });
  }, [currentName]);

  const allow = async () => {
    if (await grantThemeConsent(win)) {
      setPhase({ k: "loading" });
      started.current = false;
    }
  };

  const body = (() => {
    switch (phase.k) {
      case "consent":
        return (
          <p data-testid="theme-browser-consent">
            {consentText(prefs.networkEnabled, prefs.networkAllowThemes)}
          </p>
        );
      case "loading":
        return (
          <p role="status" data-testid="theme-browser-loading">
            Loading the themes list…
          </p>
        );
      case "error":
        return (
          <div role="alert" className="vault-error-text">
            {phase.message}
          </div>
        );
      case "ready":
        break;
    }
    const c = loaded!;
    return (
      <div className="vault-tb" onKeyDown={onKeyDown}>
        <div className="vault-tb__bar">
          <input
            ref={search}
            className="vault-input vault-tb__search"
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls="vault-tb-grid"
            aria-activedescendant={current ? cardId(current) : undefined}
            aria-label="Search themes"
            placeholder="Search themes (name, author, tag)"
            spellCheck={false}
            value={filters.query}
            onChange={(e) => setFilters({ ...filters, query: e.target.value })}
          />
          <select
            className="vault-input vault-tb__select"
            aria-label="Tag"
            value={filters.tag}
            onChange={(e) => setFilters({ ...filters, tag: e.target.value })}
          >
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t.tag} value={t.tag}>
                {t.tag} ({t.count})
              </option>
            ))}
          </select>
          <select
            className="vault-input vault-tb__select"
            aria-label="Mode"
            value={filters.mode}
            onChange={(e) =>
              setFilters({
                ...filters,
                mode: e.target.value as Filters["mode"],
              })
            }
          >
            <option value="all">Dark and light</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
        <p
          className="vault-tb__status"
          role="status"
          data-testid="theme-browser-status"
        >
          {shown.length} of {c.catalogue.entries.length} themes
          {c.stale
            ? `. Offline? Showing the list saved ${ago(c.catalogue.fetchedAt)}${
                c.notice ? ` (${c.notice})` : ""
              }.`
            : `. List updated ${ago(c.catalogue.fetchedAt)}.`}
          {message ? ` ${message}.` : ""}
        </p>
        {error && (
          <div className="vault-error-text" role="alert">
            {error}
          </div>
        )}
        <ul
          id="vault-tb-grid"
          ref={grid}
          className="vault-tb__grid"
          role="listbox"
          aria-label="Community themes"
        >
          {cards.map((entry) => {
            const status = statusOf(entry);
            const isCurrent = entry === current;
            return (
              <li
                key={entry.name}
                id={cardId(entry)}
                role="option"
                aria-selected={isCurrent}
                className={`vault-tb__card${isCurrent ? " is-current" : ""}`}
                data-testid={`theme-card-${entry.name}`}
                onClick={() => setSelected(entry.name)}
              >
                <Preview entry={entry} load={loadPreview} />
                <div className="vault-tb__head">
                  <strong className="vault-tb__name">{entry.name}</strong>
                  {status === "installed" && (
                    <span className="vault-tb__badge">Installed</span>
                  )}
                  {status === "update" && (
                    <span className="vault-tb__badge is-update">Update</span>
                  )}
                  {entry.modes.length > 0 && (
                    <span className="vault-tb__badge is-mode">
                      {entry.modes.join(" / ")}
                    </span>
                  )}
                </div>
                <div className="vault-tb__meta">{entry.author}</div>
                {entry.description && !GENERIC_DESC.test(entry.description) && (
                  <div className="vault-tb__desc">{entry.description}</div>
                )}
                {(entry.credit || entry.licence || entry.homepage) && (
                  <div className="vault-tb__credit" title={creditTitle(entry)}>
                    {entry.licence && (
                      <span className="vault-tb__licence">{entry.licence}</span>
                    )}
                    {entry.homepage && (
                      <ExternalLink href={entry.homepage} onError={setError}>
                        Source
                      </ExternalLink>
                    )}
                  </div>
                )}
                <div className="vault-tb__actions">
                  <button
                    type="button"
                    tabIndex={-1}
                    className={`vault-btn vault-btn--sm${
                      status === "installed" ? "" : " vault-btn--primary"
                    }`}
                    disabled={busy !== null}
                    onClick={() => {
                      setSelected(entry.name);
                      act(entry);
                    }}
                  >
                    {busy === entry.name ? "Working…" : ACTION_LABEL[status]}
                  </button>
                  {status !== "available" && (
                    <button
                      type="button"
                      tabIndex={-1}
                      className="vault-btn vault-btn--sm"
                      disabled={busy !== null}
                      onClick={() => void remove(entry)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {cards.length === 0 && (
          <p className="vault-tb__empty">No theme matches.</p>
        )}
        {shown.length > cards.length && (
          <p className="vault-tb__empty">
            Showing the first {MAX_CARDS}. Narrow the search to see the rest.
          </p>
        )}
        <p className="vault-tb__hint">
          {`${key(B.up)} ${key(B.down)} ${key(B.prev)} ${key(
            B.next,
          )} move, ${key(B.activate)} installs or uses, ${key(
            B.remove,
          )} removes (Shift+Delete in the search box), ${key(
            B.search,
          )} searches. Rebind them under Themes in Settings, Hotkeys.`}
        </p>
      </div>
    );
  })();

  const footer = (() => {
    const close = (label = "Close") => (
      <button
        type="button"
        className="vault-btn"
        onClick={onClose}
        disabled={phase.k === "loading"}
      >
        {label}
      </button>
    );
    switch (phase.k) {
      case "consent":
        return (
          <>
            {close("Not now")}
            <button
              type="button"
              className="vault-btn vault-btn--primary"
              onClick={() => void allow()}
            >
              Allow
            </button>
          </>
        );
      case "error":
        return (
          <>
            {close()}
            <button
              type="button"
              className="vault-btn vault-btn--primary"
              onClick={() => {
                forceNext.current = true;
                started.current = false;
                setPhase({ k: "loading" });
              }}
            >
              Try again
            </button>
          </>
        );
      case "ready":
        return (
          <>
            <button
              type="button"
              className="vault-btn"
              disabled={busy !== null}
              onClick={() => {
                forceNext.current = true;
                started.current = false;
                setPhase({ k: "loading" });
              }}
            >
              Refresh list
            </button>
            {close()}
          </>
        );
      default:
        return close();
    }
  })();

  return (
    <Dialog
      title="Community themes"
      titleId="theme-browser-title"
      testId="theme-browser-dialog"
      className="vd-dialog--wide vault-tb-dialog"
      onClose={onClose}
      busy={busy !== null}
      footer={footer}
    >
      {body}
    </Dialog>
  );
};

const cardId = (entry: CatalogueEntry) =>
  `vault-tb-${entry.name
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()}-${entry.sha256.slice(0, 6)}`;

/** Credit and licence in full, for the tooltip on the card's details line. */
const creditTitle = (entry: CatalogueEntry) =>
  [
    entry.credit && `Credit: ${entry.credit}`,
    entry.licence && `Licence: ${entry.licence}`,
  ]
    .filter(Boolean)
    .join("\n");
