import { useSyncExternalStore } from "react";

import { stripDrawingExt } from "../../vault/fileKind";

import "./links.css";

import type { ReactNode } from "react";

import type { SuggestRow, WikiAutocomplete } from "./wikiAutocomplete";

const POPUP_WIDTH = 320;
const POPUP_MAX_HEIGHT = 280;

/** `text` with the characters at `positions` wrapped in <mark>. */
export function highlightRange(
  text: string,
  from: number,
  to: number,
  positions: ReadonlySet<number>,
): ReactNode {
  if (positions.size === 0) {
    return text.slice(from, to);
  }
  const out: ReactNode[] = [];
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

function TagRow({ row }: { row: SuggestRow }) {
  return (
    <>
      <span className="vault-suggest__name vault-suggest__name--tag">
        {highlightRange(
          row.target,
          0,
          row.target.length,
          new Set(row.positions),
        )}
      </span>
      <span className="vault-suggest__count">{row.count}</span>
    </>
  );
}

function Row({ row }: { row: SuggestRow }) {
  if (row.count !== undefined) {
    return <TagRow row={row} />;
  }
  const path = row.path;
  const end = stripDrawingExt(path).length;
  const slash = path.lastIndexOf("/") + 1;
  const marks = new Set(row.positions);
  return (
    <>
      <span className="vault-suggest__name">
        {highlightRange(path, slash, end, marks)}
      </span>
      {slash > 0 && (
        <span className="vault-suggest__folder">
          {highlightRange(path, 0, slash - 1, marks)}
        </span>
      )}
    </>
  );
}

/** The `[[` and `#` popup. Never takes focus: items act on mousedown. */
export function LinkSuggest({ controller }: { controller: WikiAutocomplete }) {
  const state = useSyncExternalStore(
    (cb) => controller.subscribe(() => cb()),
    () => controller.state,
  );
  if (!state) {
    return null;
  }
  const left = Math.max(
    4,
    Math.min(state.x, window.innerWidth - POPUP_WIDTH - 4),
  );
  const above = state.y + POPUP_MAX_HEIGHT > window.innerHeight;
  const style = above
    ? { left, bottom: Math.max(4, window.innerHeight - state.y + 24) }
    : { left, top: state.y };
  const items = state.rows.length + (state.create ? 1 : 0);
  return (
    <div
      className="vault-suggest"
      role="listbox"
      aria-label="Suggestions"
      tabIndex={-1}
      aria-activedescendant={`vault-suggest-${state.selected}`}
      style={style}
      onMouseDown={(e) => e.preventDefault()}
    >
      {state.rows.map((row, i) => (
        <div
          key={row.path}
          id={`vault-suggest-${i}`}
          role="option"
          aria-selected={i === state.selected}
          className={
            i === state.selected
              ? "vault-suggest__row vault-suggest__row--active"
              : "vault-suggest__row"
          }
          onMouseEnter={() => controller.select(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            controller.accept(i);
          }}
        >
          <Row row={row} />
        </div>
      ))}
      {state.create && (
        <div
          id={`vault-suggest-${items - 1}`}
          role="option"
          aria-selected={state.selected === items - 1}
          className={
            state.selected === items - 1
              ? "vault-suggest__row vault-suggest__row--create vault-suggest__row--active"
              : "vault-suggest__row vault-suggest__row--create"
          }
          onMouseEnter={() => controller.select(items - 1)}
          onMouseDown={(e) => {
            e.preventDefault();
            controller.accept(items - 1);
          }}
        >
          + Create &ldquo;{state.create}&rdquo;
        </div>
      )}
    </div>
  );
}
