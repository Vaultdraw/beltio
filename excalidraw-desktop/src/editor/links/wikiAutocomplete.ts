/**
 * `[[` and `#` autocomplete while editing text: one engine, one `input`
 * listener, a small list of triggers. Cost model (the hard budget):
 * - idle: one childList MutationObserver on the editor container;
 * - while a text element is edited: one `input` listener on its textarea,
 *   which scans back from the caret on the current line (O(line), at most
 *   MAX_SCAN chars) and does nothing unless it finds an open `[[`;
 * - only while the popup is open: one capture keydown listener on document.
 * The textarea never loses focus (blur would submit the text).
 */
import { stripDrawingExt } from "../../vault/fileKind";
import { MAX_LINK_CHARS } from "../../links/grammar";
import { linkTargetFor, wikiLink } from "../../links/format";
import { foldKey } from "../../links/resolve";

import { createTagTrigger } from "../tags/tagTrigger";

import { SuggestRanker } from "./suggestRank";

import type { LinkResolver } from "../../links/resolve";
import type { LinksSettings } from "../../links/types";
import type { TagCount, TagsSettings } from "../../tags/types";

const MAX_SCAN = MAX_LINK_CHARS + 2;
export const MAX_SUGGESTIONS = 8;

export type OpenLink = {
  /** Index of the first `[` of the `[[`. */
  start: number;
  /** Text between `[[` and the caret (before a `|`). */
  query: string;
  /** The caret is in the `|label` part: no suggestions. */
  inLabel: boolean;
};

/** The `[[` the caret is inside of, on the current line, or null. */
export function findOpenLink(value: string, caret: number): OpenLink | null {
  const floor = Math.max(1, caret - MAX_SCAN);
  for (let i = caret - 1; i >= floor; i--) {
    const c = value.charCodeAt(i);
    if (c === 10) {
      return null;
    }
    if (c === 93 && value.charCodeAt(i - 1) === 93) {
      return null;
    }
    if (c === 91 && value.charCodeAt(i - 1) === 91) {
      const inner = value.slice(i + 1, caret);
      const bar = inner.indexOf("|");
      return {
        start: i - 1,
        query: bar < 0 ? inner : inner.slice(0, bar),
        inLabel: bar >= 0,
      };
    }
  }
  return null;
}

export type SuggestRow = {
  path: string;
  /** Matched character indexes into `path`. */
  positions: number[];
  /** What gets inserted (between the brackets, or `#Display`). */
  target: string;
  /** Tag rows only: drawings carrying the tag. */
  count?: number;
};

/** What a trigger needs: a token before the caret, rows for it, the edit. */
export interface SuggestTrigger {
  enabled(): boolean;
  /** The open token ending at the caret (bounded backwards scan), or null. */
  find(value: string, caret: number): { start: number; query: string } | null;
  suggest(open: never): { rows: SuggestRow[]; create: string | null };
  insert(
    value: string,
    caret: number,
    open: never,
    target: string,
  ): InsertResult;
}

export type SuggestState = {
  rows: SuggestRow[];
  /** Name for the trailing `+ Create "x"` row, or null. */
  create: string | null;
  /** 0..rows.length (rows.length = the create row). */
  selected: number;
  /** Viewport coordinates just under the caret. */
  x: number;
  y: number;
  query: string;
};

export type InsertResult = { value: string; caret: number };

/** The textarea text after accepting `target` for the open link. */
export function insertLink(
  value: string,
  caret: number,
  open: OpenLink,
  target: string,
): InsertResult {
  const before = value.slice(0, open.start);
  let after = value.slice(caret);
  if (after.startsWith("]]")) {
    after = after.slice(2);
  }
  const link = wikiLink(target);
  return { value: before + link + after, caret: before.length + link.length };
}

/** Pixel position of the caret in a textarea (mirror-div technique). */
let mirror: HTMLDivElement | null = null;
const COPIED = [
  "boxSizing",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontSize",
  "fontFamily",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textTransform",
  "textIndent",
  "whiteSpace",
  "wordBreak",
  "tabSize",
] as const;

export function caretViewportPoint(
  textarea: HTMLTextAreaElement,
  pos: number,
): { x: number; y: number } {
  const rect = textarea.getBoundingClientRect();
  const style = getComputedStyle(textarea);
  if (!mirror) {
    mirror = document.createElement("div");
    mirror.setAttribute("aria-hidden", "true");
    Object.assign(mirror.style, {
      position: "fixed",
      visibility: "hidden",
      top: "0",
      left: "-99999px",
      overflow: "hidden",
    });
  }
  const m = mirror;
  for (const prop of COPIED) {
    m.style[prop as never] = style[prop as never];
  }
  m.style.width = `${textarea.offsetWidth}px`;
  m.textContent = textarea.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(pos) || ".";
  m.appendChild(marker);
  document.body.appendChild(m);
  const scale = textarea.offsetWidth ? rect.width / textarea.offsetWidth : 1;
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize);
  const x = rect.left + (marker.offsetLeft - textarea.scrollLeft) * scale;
  const y =
    rect.top + (marker.offsetTop - textarea.scrollTop + lineHeight) * scale + 2;
  m.remove();
  return { x, y };
}

export interface WikiAutocompleteDeps {
  container: HTMLElement;
  getNames(): readonly string[];
  /**
   * False while the names are not yet the vault's complete list: `[[`
   * suggestions wait (no wrong short names, no "Create" for a drawing that
   * exists). Default: true.
   */
  namesReady?(): boolean;
  getResolver(): LinkResolver;
  getSettings(): LinksSettings;
  getCurrentPath(): string | null;
  /** Palette recents (`drawing:<path>` keys), most recent first. */
  getRecent?(): readonly string[];
  /** "Create 'x'": the app creates the drawing. */
  onCreate(target: string): void;
  /** `tags.autocomplete` (default when omitted: DEFAULT_TAGS_SETTINGS). */
  getTagsSettings?(): TagsSettings;
  /** The vault's tags (default: the tag store). */
  getTags?(): readonly TagCount[];
}

const SELECTOR = "textarea.excalidraw-wysiwyg";

export class WikiAutocomplete {
  private observer: MutationObserver | null = null;
  private textarea: HTMLTextAreaElement | null = null;
  private open: { trigger: SuggestTrigger; found: unknown } | null = null;
  private current: SuggestState | null = null;
  private listeners = new Set<(s: SuggestState | null) => void>();
  private ranker = new SuggestRanker();
  private inserting = false;
  private cancelWarm: (() => void) | null = null;

  private readonly triggers: SuggestTrigger[];

  constructor(private readonly deps: WikiAutocompleteDeps) {
    const links: SuggestTrigger = {
      enabled: () =>
        deps.getSettings().autocomplete && (deps.namesReady?.() ?? true),
      find: findOpenLink,
      suggest: (open: OpenLink) => {
        if (open.inLabel) {
          return { rows: [], create: null };
        }
        const rows = this.rank(open.query);
        return { rows, create: this.createName(open.query, rows) };
      },
      insert: (value, caret, open: OpenLink, target) =>
        insertLink(value, caret, open, target),
    };
    this.triggers = [
      links,
      createTagTrigger({
        getSettings: deps.getTagsSettings,
        getTags: deps.getTags,
      }),
    ];
  }

  /** The names list changed (for example it finished loading): re-suggest. */
  namesChanged(): void {
    if (this.textarea && !this.inserting) {
      this.refresh();
    }
  }

  get state() {
    return this.current;
  }

  subscribe(listener: (s: SuggestState | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.observer) {
      return;
    }
    this.observer = new MutationObserver(this.onMutations);
    this.observer.observe(this.deps.container, {
      childList: true,
      subtree: true,
    });
    const existing =
      this.deps.container.querySelector<HTMLTextAreaElement>(SELECTOR);
    if (existing) {
      this.attach(existing);
    }
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.detach();
  }

  private onMutations = (records: MutationRecord[]) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) {
          continue;
        }
        const el = node as Element;
        const ta = el.matches(SELECTOR)
          ? (el as HTMLTextAreaElement)
          : el.querySelector<HTMLTextAreaElement>(SELECTOR);
        if (ta) {
          this.attach(ta);
        }
      }
      if (this.textarea && !this.textarea.isConnected) {
        this.detach();
      }
    }
  };

  private attach(ta: HTMLTextAreaElement) {
    if (this.textarea === ta) {
      return;
    }
    this.detach();
    this.ranker.reset();
    if (this.deps.getSettings().autocomplete) {
      this.cancelWarm = this.ranker.warm(this.deps.getNames());
    }
    this.textarea = ta;
    ta.addEventListener("input", this.onInput);
    ta.addEventListener("blur", this.onBlur);
  }

  private detach() {
    const ta = this.textarea;
    this.textarea = null;
    this.cancelWarm?.();
    this.cancelWarm = null;
    if (ta) {
      ta.removeEventListener("input", this.onInput);
      ta.removeEventListener("blur", this.onBlur);
    }
    this.close();
  }

  private onBlur = () => this.close();

  private onInput = () => {
    if (!this.inserting) {
      this.refresh();
    }
  };

  private refresh() {
    const ta = this.textarea;
    if (!ta) {
      this.close();
      return;
    }
    const caret = ta.selectionStart;
    let trigger: SuggestTrigger | null = null;
    let found: { start: number; query: string } | null = null;
    if (caret === ta.selectionEnd) {
      for (const t of this.triggers) {
        if (t.enabled() && (found = t.find(ta.value, caret))) {
          trigger = t;
          break;
        }
      }
    }
    if (!trigger || !found) {
      this.close();
      return;
    }
    const previous = this.current;
    const sameTrigger = this.open?.trigger === trigger;
    this.open = { trigger, found };
    const { rows, create } = trigger.suggest(found as never);
    const at = caretViewportPoint(ta, caret);
    this.current = {
      rows,
      create,
      selected:
        previous && sameTrigger && previous.query === found.query
          ? Math.min(previous.selected, rows.length + (create ? 1 : 0) - 1)
          : 0,
      x: at.x,
      y: at.y,
      query: found.query,
    };
    if (rows.length === 0 && !create) {
      this.close();
      return;
    }
    this.armKeys();
    this.emit();
  }

  /** Ranked names (palette rank), with the text each would insert. */
  rank(query: string): SuggestRow[] {
    const ranked = this.ranker.rank(
      this.deps.getNames(),
      query,
      this.deps.getRecent?.() ?? [],
      MAX_SUGGESTIONS,
    );
    const { newLinkFormat } = this.deps.getSettings();
    const resolver = this.deps.getResolver();
    const from = this.deps.getCurrentPath();
    const rows: SuggestRow[] = [];
    for (const row of ranked) {
      if (row.kind === "drawing") {
        rows.push({
          path: row.drawing.path,
          positions: row.positions,
          target: linkTargetFor(
            row.drawing.path,
            from,
            resolver,
            newLinkFormat,
          ),
        });
      }
    }
    return rows;
  }

  private createName(query: string, rows: SuggestRow[]): string | null {
    const name = query.trim();
    if (!name) {
      return null;
    }
    const key = foldKey(name);
    const exists = rows.some((r) => {
      const bare = foldKey(stripDrawingExt(r.path));
      return bare === key || bare.endsWith(`/${key}`);
    });
    return exists ? null : name;
  }

  // -- keys (only while the popup is open) --------------------------------

  private keysArmed = false;
  private armKeys() {
    if (!this.keysArmed) {
      this.keysArmed = true;
      document.addEventListener("keydown", this.onKey, true);
    }
  }
  private disarmKeys() {
    if (this.keysArmed) {
      this.keysArmed = false;
      document.removeEventListener("keydown", this.onKey, true);
    }
  }

  private onKey = (e: KeyboardEvent) => {
    const s = this.current;
    if (!s || e.target !== this.textarea || e.isComposing) {
      return;
    }
    const count = s.rows.length + (s.create ? 1 : 0);
    const claim = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === "ArrowDown" || (ctrl && e.key.toLowerCase() === "n")) {
      claim();
      this.select((s.selected + 1) % count);
    } else if (e.key === "ArrowUp" || (ctrl && e.key.toLowerCase() === "p")) {
      claim();
      this.select((s.selected + count - 1) % count);
    } else if (
      (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) ||
      (e.key === "Tab" && !e.shiftKey)
    ) {
      claim();
      this.accept(s.selected);
    } else if (e.key === "Escape") {
      claim();
      this.close();
    } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      setTimeout(() => this.refresh(), 0);
    }
  };

  select(i: number) {
    if (this.current) {
      this.current = { ...this.current, selected: i };
      this.emit();
    }
  }

  /** Insert row `i` (the create row when `i === rows.length`). */
  accept(i: number): void {
    const ta = this.textarea;
    const s = this.current;
    const open = this.open;
    if (!ta || !s || !open) {
      return;
    }
    let target: string;
    if (i < s.rows.length) {
      target = s.rows[i].target;
    } else if (s.create) {
      target = s.create;
      this.deps.onCreate(s.create);
    } else {
      return;
    }
    const next = open.trigger.insert(
      ta.value,
      ta.selectionStart,
      open.found as never,
      target,
    );
    this.close();
    this.inserting = true;
    try {
      ta.value = next.value;
      ta.setSelectionRange(next.caret, next.caret);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    } finally {
      this.inserting = false;
    }
  }

  close(): void {
    this.open = null;
    this.disarmKeys();
    if (this.current) {
      this.current = null;
      this.emit();
    }
  }

  private emit() {
    for (const l of [...this.listeners]) {
      l(this.current);
    }
  }
}
