/**
 * The Links dock: Backlinks / Outgoing for the open drawing, in the
 * navigator. Queries nothing while hidden; "Unlinked mentions" is computed
 * only while its section is expanded. Keyboard (Vim style, `list.*`
 * commands, rebindable): j/k or arrows
 * move, Enter/o opens (or creates / toggles), Tab switches tabs, h/l
 * collapse/expand the section.
 */
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { userError } from "../userError";

import { drawingStem } from "../../vault/fileKind";

import { useListKeys } from "../../commands/useListKeys";
import { IconChevronDown, IconChevronRight } from "../Icons";
import { DrawingTags } from "../tags/TagChips";

import "./LinksDock.css";

import type { ReactNode, Ref } from "react";

import type {
  BackLink,
  LinksResponse,
  MentionsResponse,
  OutLink,
  VaultLinks,
} from "../../links/types";

export const DOCK_DEBOUNCE_MS = 120;
const MAX_ROWS = 300;

export type LinksDockHandle = { focus(): void };

export type LinksDockProps = {
  links: VaultLinks | null;
  handle: string | null;
  path: string | null;
  /** Bumped by the app when the index changed (index status events). */
  refreshKey?: number | string;
  onOpen(path: string, elementId?: string): void;
  /** "Create" an unresolved target. */
  onCreate(target: string): void;
  visible: boolean;
  ref?: Ref<LinksDockHandle>;
};

type Tab = "backlinks" | "outgoing";
type Section = "linked" | "unlinked" | "outgoing" | "unresolved";

type Row =
  | {
      key: string;
      kind: "header";
      section: Section;
      title: string;
      count: number | null;
    }
  | { key: string; kind: "backlink"; section: Section; item: BackLink }
  | { key: string; kind: "outgoing"; section: Section; item: OutLink }
  | { key: string; kind: "unresolved"; section: Section; item: OutLink };

const SECTIONS: Record<Tab, Section[]> = {
  backlinks: ["linked", "unlinked"],
  outgoing: ["outgoing", "unresolved"],
};
const TITLES: Record<Section, string> = {
  linked: "Linked mentions",
  unlinked: "Unlinked mentions",
  outgoing: "Links",
  unresolved: "Unresolved links",
};

const stripExt = (p: string) => drawingStem(p);
const baseName = (p: string) => stripExt(p.slice(p.lastIndexOf("/") + 1));
const folderOf = (p: string) =>
  p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";

function snippet(
  text: string,
  highlights: readonly [number, number][],
): ReactNode {
  if (highlights.length === 0) {
    return text;
  }
  const out: ReactNode[] = [];
  let at = 0;
  highlights.forEach(([s, e], i) => {
    const start = Math.max(at, Math.min(s, text.length));
    const end = Math.max(start, Math.min(e, text.length));
    if (start > at) {
      out.push(text.slice(at, start));
    }
    if (end > start) {
      out.push(<mark key={i}>{text.slice(start, end)}</mark>);
    }
    at = end;
  });
  if (at < text.length) {
    out.push(text.slice(at));
  }
  return out;
}

export function buildRows(
  tab: Tab,
  data: LinksResponse | null,
  mentions: MentionsResponse | null,
  collapsed: Readonly<Record<Section, boolean>>,
): Row[] {
  const rows: Row[] = [];
  for (const section of SECTIONS[tab]) {
    let items: Row[] = [];
    let count: number | null = null;
    if (section === "linked" && data) {
      count = data.backlinks.length;
      items = data.backlinks.slice(0, MAX_ROWS).map((item, i) => ({
        key: `b:${item.path}:${item.elementId}:${i}`,
        kind: "backlink",
        section,
        item,
      }));
    } else if (section === "unlinked") {
      count = mentions ? mentions.mentions.length : null;
      items = (mentions?.mentions ?? []).slice(0, MAX_ROWS).map((item, i) => ({
        key: `m:${item.path}:${item.elementId}:${i}`,
        kind: "backlink",
        section,
        item,
      }));
    } else if (section === "outgoing" && data) {
      count = data.outgoing.length;
      items = data.outgoing.slice(0, MAX_ROWS).map((item, i) => ({
        key: `o:${item.elementId}:${i}`,
        kind: "outgoing",
        section,
        item,
      }));
    } else if (section === "unresolved" && data) {
      count = data.unresolved.length;
      items = data.unresolved.slice(0, MAX_ROWS).map((item, i) => ({
        key: `u:${item.elementId}:${i}`,
        kind: "unresolved",
        section,
        item,
      }));
    }
    rows.push({
      key: `h:${section}`,
      kind: "header",
      section,
      title: TITLES[section],
      count,
    });
    if (!collapsed[section]) {
      rows.push(...items);
    }
  }
  return rows;
}

export function LinksDock(props: LinksDockProps) {
  const { links, handle, path, refreshKey, onOpen, onCreate, visible } = props;
  const [tab, setTab] = useState<Tab>("backlinks");
  const [collapsed, setCollapsed] = useState<Record<Section, boolean>>({
    linked: false,
    unlinked: true,
    outgoing: false,
    unresolved: false,
  });
  const [data, setData] = useState<LinksResponse | null>(null);
  const [mentions, setMentions] = useState<MentionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(
    props.ref,
    () => ({ focus: () => rootRef.current?.focus() }),
    [],
  );

  const active = visible && !!links && !!handle && !!path;
  const wantMentions = active && tab === "backlinks" && !collapsed.unlinked;

  // Main query: on open, drawing change and index refresh (debounced).
  const have = data?.path === path;
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    let live = true;
    const timer = setTimeout(
      () => {
        links!.links(handle!, path!).then(
          (res) => {
            if (live) {
              setData(res);
              setError(null);
            }
          },
          (err) => live && setError(userError(err)),
        );
      },
      have ? DOCK_DEBOUNCE_MS : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `have` only picks the delay; refetching because it flipped would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, links, handle, path, refreshKey]);

  // Unlinked mentions: only while the section is expanded.
  const haveMentions = mentions?.path === path;
  useEffect(() => {
    if (!wantMentions) {
      return undefined;
    }
    let live = true;
    const timer = setTimeout(
      () => {
        links!.unlinkedMentions(handle!, path!).then(
          (res) => live && setMentions(res),
          () => live && setMentions({ path: path!, mentions: [], tookMs: 0 }),
        );
      },
      haveMentions ? DOCK_DEBOUNCE_MS : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantMentions, links, handle, path, refreshKey]);

  const shown = have ? data : null;
  const shownMentions = haveMentions ? mentions : null;
  const rows = useMemo(
    () => buildRows(tab, shown, shownMentions, collapsed),
    [tab, shown, shownMentions, collapsed],
  );
  const selectedIndex = Math.max(
    0,
    rows.findIndex((r) => r.key === selectedKey),
  );
  const selected = rows[selectedIndex];

  useEffect(() => {
    const el = rootRef.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    el?.scrollIntoView?.({ block: "nearest" });
  }, [selected?.key]);

  const toggle = useCallback((section: Section, value?: boolean) => {
    setCollapsed((c) => ({ ...c, [section]: value ?? !c[section] }));
  }, []);

  const activate = useCallback(
    (row: Row | undefined) => {
      if (!row) {
        return;
      }
      if (row.kind === "header") {
        toggle(row.section);
      } else if (row.kind === "backlink") {
        onOpen(row.item.path, row.item.elementId);
      } else if (row.kind === "outgoing") {
        if (row.item.resolved) {
          onOpen(row.item.resolved);
        }
      } else {
        onCreate(row.item.target);
      }
    },
    [onCreate, onOpen, toggle],
  );

  const move = (delta: number) => {
    const next =
      rows[Math.min(rows.length - 1, Math.max(0, selectedIndex + delta))];
    if (next) {
      setSelectedKey(next.key);
    }
  };

  // Keys are `list.*` commands: j/k move, Enter/o open, Tab switches tabs,
  // h/l collapse/expand the section, g/G first/last.
  const fold = (open: boolean) => () => {
    if (selected) {
      toggle(selected.section, !open);
      if (!open) {
        setSelectedKey(`h:${selected.section}`);
      }
    }
  };
  useListKeys(
    rootRef,
    "links",
    visible
      ? {
          down: () => move(1),
          up: () => move(-1),
          first: () => setSelectedKey(rows[0]?.key ?? null),
          last: () => setSelectedKey(rows[rows.length - 1]?.key ?? null),
          open: () => activate(selected),
          nextView: () => {
            setTab((t) => (t === "backlinks" ? "outgoing" : "backlinks"));
            setSelectedKey(null);
          },
          expand: fold(true),
          collapse: fold(false),
        }
      : null,
  );

  if (!visible) {
    return null;
  }

  const backCount = shown?.backlinks.length;
  const outCount = shown
    ? shown.outgoing.length + shown.unresolved.length
    : undefined;

  return (
    <div
      ref={rootRef}
      className="vault-links"
      tabIndex={0}
      role="region"
      aria-label="Links"
    >
      <DrawingTags path={path} />
      <div className="vault-links__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          tabIndex={-1}
          aria-selected={tab === "backlinks"}
          className="vault-links__tab"
          onClick={() => {
            setTab("backlinks");
            setSelectedKey(null);
          }}
        >
          Backlinks{backCount === undefined ? "" : ` (${backCount})`}
        </button>
        <button
          type="button"
          role="tab"
          tabIndex={-1}
          aria-selected={tab === "outgoing"}
          className="vault-links__tab"
          onClick={() => {
            setTab("outgoing");
            setSelectedKey(null);
          }}
        >
          Outgoing{outCount === undefined ? "" : ` (${outCount})`}
        </button>
      </div>
      <div
        className="vault-links__list"
        role="listbox"
        aria-label={tab === "backlinks" ? "Backlinks" : "Outgoing links"}
      >
        {error && <div className="vault-links__empty">{error}</div>}
        {rows.map((row) => {
          const isSelected = row.key === selected?.key;
          const cls = `vd-row vault-links__row vault-links__row--${row.kind}${
            isSelected ? " vault-links__row--selected" : ""
          }`;
          if (row.kind === "header") {
            const open = !collapsed[row.section];
            return (
              <div
                key={row.key}
                role="option"
                aria-selected={isSelected}
                data-expanded={open}
                className={cls}
                onClick={() => {
                  setSelectedKey(row.key);
                  toggle(row.section);
                }}
              >
                {open ? <IconChevronDown /> : <IconChevronRight />}
                <span className="vault-links__title">{row.title}</span>
                {row.count !== null && (
                  <span className="vault-links__count">{row.count}</span>
                )}
              </div>
            );
          }
          if (row.kind === "backlink") {
            const { item } = row;
            return (
              <div
                key={row.key}
                role="option"
                aria-selected={isSelected}
                className={cls}
                onClick={() => {
                  setSelectedKey(row.key);
                  activate(row);
                }}
              >
                <div className="vault-links__source">
                  <span className="vault-links__name">
                    {baseName(item.path)}
                  </span>
                  {folderOf(item.path) && (
                    <span className="vault-links__folder">
                      {folderOf(item.path)}
                    </span>
                  )}
                </div>
                {(item.snippet || item.kind === "shape") && (
                  <div className="vault-links__snippet">
                    {item.kind === "shape" && (
                      <span className="vault-links__badge">link</span>
                    )}
                    {snippet(item.snippet, item.highlights)}
                  </div>
                )}
              </div>
            );
          }
          const { item } = row;
          const unresolved = row.kind === "unresolved";
          return (
            <div
              key={row.key}
              role="option"
              aria-selected={isSelected}
              className={cls}
              onClick={() => {
                setSelectedKey(row.key);
                activate(row);
              }}
            >
              <div className="vault-links__source">
                <span className="vault-links__name">{item.target}</span>
                {item.label && (
                  <span className="vault-links__folder">{item.label}</span>
                )}
                {item.kind === "shape" && (
                  <span className="vault-links__badge">link</span>
                )}
                {unresolved && (
                  <button
                    type="button"
                    tabIndex={-1}
                    className="vault-links__create"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCreate(item.target);
                    }}
                  >
                    Create
                  </button>
                )}
              </div>
              {!unresolved && item.resolved && (
                <div className="vault-links__snippet">
                  {stripExt(item.resolved)}
                </div>
              )}
            </div>
          );
        })}
        {shown && rows.every((r) => r.kind === "header") && !error && (
          <div className="vault-links__empty">
            {tab === "backlinks" ? "No backlinks" : "No outgoing links"}
          </div>
        )}
      </div>
    </div>
  );
}
