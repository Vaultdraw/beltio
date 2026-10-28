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

import { Dialog } from "../components/Dialog";
import { keyBelongsToControl } from "../components/keyTarget";

import { filterTemplates } from "./search";
import { templateKey } from "./types";

import "./TemplatePicker.css";

import type { TemplateEntry } from "./types";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export interface TemplatePickerProps {
  ownerDocument: Document;
  vaultName: string;
  vaultTemplates: TemplateEntry[];
  globalTemplates: TemplateEntry[];
  loading: boolean;
  error?: string;
  templatesFolder: string;
  renderThumbnail: (t: TemplateEntry) => Promise<string | null>;
  /** Called when a row leaves the viewport before its thumbnail finished. */
  cancelThumbnail?: (t: TemplateEntry) => void;
  onPick(t: TemplateEntry): void;
  onBlank?(): void;
  onClose(): void;
  onRevealGlobal?(): void;
}

/* ---- Visibility registry: one IntersectionObserver for all rows ---- */

type VisibilityCallbacks = (visible: boolean) => void;

class VisibilityRegistry {
  private io: IntersectionObserver | null = null;
  private root: Element | null = null;
  private callbacks = new Map<Element, VisibilityCallbacks>();

  setRoot(root: Element | null) {
    if (root === this.root) {
      return;
    }
    this.io?.disconnect();
    this.io = null;
    this.root = root;
    if (root && typeof IntersectionObserver !== "undefined") {
      this.io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            this.callbacks.get(e.target)?.(e.isIntersecting);
          }
        },
        { root, rootMargin: "120px 0px" },
      );
      this.callbacks.forEach((_, el) => this.io!.observe(el));
    }
  }

  observe(el: Element, cb: VisibilityCallbacks) {
    this.callbacks.set(el, cb);
    if (this.io) {
      this.io.observe(el);
    } else if (typeof IntersectionObserver === "undefined") {
      // No IntersectionObserver (very old webview): treat as visible.
      cb(true);
    }
    return () => {
      this.callbacks.delete(el);
      this.io?.unobserve(el);
    };
  }

  dispose() {
    this.io?.disconnect();
    this.io = null;
    this.callbacks.clear();
  }
}

/* ---- Row ---- */

interface RowProps {
  entry: TemplateEntry;
  index: number;
  optionId: string;
  active: boolean;
  registry: VisibilityRegistry;
  renderThumbnail: TemplatePickerProps["renderThumbnail"];
  cancelThumbnail?: TemplatePickerProps["cancelThumbnail"];
  onPick: (t: TemplateEntry) => void;
  onHover: (index: number) => void;
}

// One shared formatter: toLocaleDateString() builds a new Intl formatter on
// every call, which dominated the picker's first render.
let dateFormat: Intl.DateTimeFormat | undefined;
const formatDate = (ms: number) => {
  try {
    dateFormat ??= new Intl.DateTimeFormat();
    return dateFormat.format(ms);
  } catch {
    return "";
  }
};

const Row = memo(
  ({
    entry,
    index,
    optionId,
    active,
    registry,
    renderThumbnail,
    cancelThumbnail,
    onPick,
    onHover,
  }: RowProps) => {
    const ref = useRef<HTMLDivElement>(null);
    const [thumb, setThumb] = useState<string | null | undefined>(undefined);
    const latest = useRef({ renderThumbnail, cancelThumbnail, entry });
    latest.current = { renderThumbnail, cancelThumbnail, entry };

    useEffect(() => {
      const el = ref.current;
      if (!el) {
        return undefined;
      }
      let requested = false;
      let settled = false;
      let alive = true;
      const unobserve = registry.observe(el, (visible) => {
        if (visible && !requested) {
          requested = true;
          const t = latest.current.entry;
          latest.current.renderThumbnail(t).then(
            (url) => {
              if (!alive) {
                return;
              }
              settled = true;
              setThumb(url);
            },
            () => {
              if (alive) {
                settled = true;
                setThumb(null);
              }
            },
          );
        } else if (!visible && requested && !settled) {
          requested = false;
          latest.current.cancelThumbnail?.(latest.current.entry);
        }
      });
      return () => {
        alive = false;
        unobserve();
        if (requested && !settled) {
          latest.current.cancelThumbnail?.(latest.current.entry);
        }
      };
    }, [registry]);

    return (
      <div
        ref={ref}
        id={optionId}
        role="option"
        aria-selected={active}
        className={`vd-row template-picker__row${active ? " is-active" : ""}`}
        data-template-key={templateKey(entry)}
        onClick={() => onPick(entry)}
        onMouseMove={() => !active && onHover(index)}
      >
        <div className="template-picker__thumb" aria-hidden="true">
          {thumb ? (
            <img src={thumb} alt="" draggable={false} decoding="async" />
          ) : (
            <span
              className={`template-picker__thumb-ph${
                thumb === undefined ? " is-loading" : ""
              }`}
            />
          )}
        </div>
        <div className="template-picker__meta">
          <span className="template-picker__name">{entry.name}</span>
          <span className="template-picker__sub">
            {formatDate(entry.modifiedAt)}
          </span>
        </div>
      </div>
    );
  },
);

const BlankRow = memo(
  ({
    optionId,
    index,
    active,
    onBlank,
    onHover,
  }: {
    optionId: string;
    index: number;
    active: boolean;
    onBlank: () => void;
    onHover: (i: number) => void;
  }) => {
    return (
      <div
        id={optionId}
        role="option"
        aria-selected={active}
        className={`vd-row template-picker__row${active ? " is-active" : ""}`}
        onClick={onBlank}
        onMouseMove={() => !active && onHover(index)}
      >
        <div className="template-picker__thumb" aria-hidden="true">
          <span className="template-picker__thumb-ph" />
        </div>
        <div className="template-picker__meta">
          <span className="template-picker__name">Blank drawing</span>
          <span className="template-picker__sub">
            Start from an empty canvas
          </span>
        </div>
      </div>
    );
  },
);

/* ---- Picker ---- */

/**
 * Rows are mounted progressively: a screenful first, then the rest in small
 * chunks, one per task, so opening a large picker never blocks the UI thread
 * in one long commit (low-end Macs).
 */
const INITIAL_ROWS = 30;
const ROW_CHUNK = 50;

export const TemplatePicker = ({
  ownerDocument,
  vaultName,
  vaultTemplates,
  globalTemplates,
  loading,
  error,
  templatesFolder,
  renderThumbnail,
  cancelThumbnail,
  onPick,
  onBlank,
  onClose,
  onRevealGlobal,
}: TemplatePickerProps) => {
  const uid = useId();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const registry = useMemo(() => new VisibilityRegistry(), []);
  const blankShown = !!onBlank && deferredQuery.trim() === "";

  useEffect(() => () => registry.dispose(), [registry]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const vaultList = useMemo(
    () => filterTemplates(vaultTemplates, deferredQuery),
    [vaultTemplates, deferredQuery],
  );
  const globalList = useMemo(
    () => filterTemplates(globalTemplates, deferredQuery),
    [globalTemplates, deferredQuery],
  );
  const blankCount = blankShown ? 1 : 0;
  const total = blankCount + vaultList.length + globalList.length;
  const active = total === 0 ? -1 : Math.min(activeIndex, total - 1);
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const [rowLimit, setRowLimit] = useState(INITIAL_ROWS);
  useEffect(() => {
    if (rowLimit >= total) {
      return undefined;
    }
    const id = setTimeout(() => setRowLimit((n) => n + ROW_CHUNK), 0);
    return () => clearTimeout(id);
  }, [rowLimit, total]);
  // Always render up to the active row (e.g. End pressed before all mounted).
  const shownRows = Math.max(rowLimit, active + 1);

  useEffect(() => {
    setActiveIndex(0);
  }, [deferredQuery]);

  useEffect(() => {
    if (active < 0) {
      return;
    }
    const el = ownerDocument.getElementById(optionId(active));
    el?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ownerDocument]);

  const flat = useMemo(
    () => [...vaultList, ...globalList],
    [vaultList, globalList],
  );

  const pick = useCallback((t: TemplateEntry) => onPick(t), [onPick]);
  const blank = useCallback(() => onBlank?.(), [onBlank]);
  const hover = useCallback((i: number) => setActiveIndex(i), []);

  const activate = () => {
    if (active < 0) {
      return;
    }
    if (active < blankCount) {
      onBlank?.();
    } else {
      onPick(flat[active - blankCount]);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (total) {
          setActiveIndex((active + 1) % total);
        }
        return;
      case "ArrowUp":
        e.preventDefault();
        if (total) {
          setActiveIndex((active - 1 + total) % total);
        }
        return;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        return;
      case "End":
        e.preventDefault();
        if (total) {
          setActiveIndex(total - 1);
        }
        return;
      case "Enter":
        if (keyBelongsToControl(e, inputRef.current)) {
          return;
        }
        e.preventDefault();
        activate();
        break;
      default:
    }
  };

  const hasAny = vaultTemplates.length + globalTemplates.length > 0;
  const folder = `${templatesFolder}/`;
  const renderGroup = (label: string, items: TemplateEntry[], offset: number) =>
    items.length === 0 ? null : (
      <div role="group" aria-labelledby={`${uid}-g-${offset}`}>
        <div
          className="template-picker__group"
          id={`${uid}-g-${offset}`}
          role="presentation"
        >
          {label}
        </div>
        {items.slice(0, Math.max(0, shownRows - offset)).map((t, i) => (
          <Row
            key={templateKey(t)}
            entry={t}
            index={offset + i}
            optionId={optionId(offset + i)}
            active={active === offset + i}
            registry={registry}
            renderThumbnail={renderThumbnail}
            cancelThumbnail={cancelThumbnail}
            onPick={pick}
            onHover={hover}
          />
        ))}
      </div>
    );

  let body;
  if (error) {
    body = (
      <div className="template-picker__state" role="alert">
        {error}
      </div>
    );
  } else if (loading && !hasAny) {
    body = <div className="template-picker__state">Loading templates…</div>;
  }

  const empty = !loading && !error && !hasAny;

  return (
    <Dialog
      ariaLabel="New drawing from template"
      onClose={onClose}
      className="template-picker"
      frameRef={dialogRef}
      onFrameKeyDown={onKeyDown}
    >
      <div className="template-picker__header">
        <input
          ref={inputRef}
          className="template-picker__input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${uid}-list`}
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          aria-autocomplete="list"
          aria-label="Search templates"
          placeholder={`Search templates in ${vaultName}…`}
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div
        className="template-picker__scroll"
        ref={(el) => registry.setRoot(el)}
      >
        {body}
        {empty && (
          <div className="template-picker__state">
            <strong>No templates yet</strong>
            <p>
              Put .excalidraw files in <code>{folder}</code> in this vault, or
              in the global templates folder in the app config directory (
              <code>templates/</code>), to reuse them across vaults.
            </p>
            {onRevealGlobal && (
              <button
                type="button"
                className="vault-btn"
                onClick={onRevealGlobal}
              >
                Open global templates folder
              </button>
            )}
          </div>
        )}
        {!empty && !error && hasAny && total === 0 && (
          <div className="template-picker__state">
            No templates match “{deferredQuery.trim()}”.
          </div>
        )}
        <div
          id={`${uid}-list`}
          role="listbox"
          aria-label="Templates"
          className="template-picker__list"
        >
          {blankShown && (
            <BlankRow
              optionId={optionId(0)}
              index={0}
              active={active === 0}
              onBlank={blank}
              onHover={hover}
            />
          )}
          {renderGroup(`This vault (${folder})`, vaultList, blankCount)}
          {renderGroup("All vaults", globalList, blankCount + vaultList.length)}
        </div>
      </div>
      <div className="template-picker__footer" aria-hidden="true">
        <span>↑↓ navigate</span>
        <span>↵ use</span>
        <span>esc close</span>
      </div>
    </Dialog>
  );
};
