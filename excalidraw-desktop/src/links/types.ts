/**
 * Links P1 contract (FROZEN; mirror of src-tauri/src/links/types.rs, serde
 * camelCase). Paths are vault-relative, forward slashes, with ".excalidraw".
 */

/** Where a link lives: `[[...]]` in a text element, or an element's `link` field. */
export type LinkKind = "text" | "shape";

export type OutLink = {
  elementId: string;
  /** Bound text: the shape/arrow it labels. */
  containerId: string | null;
  kind: LinkKind;
  /** Target as written, without brackets, label or ".excalidraw" ("Graphs/BFS"). */
  target: string;
  /** `[[target|label]]` label, if any. */
  label: string | null;
  /** Resolved path, or null when unresolved. */
  resolved: string | null;
};

export type BackLink = {
  /** The drawing that links here. */
  path: string;
  elementId: string;
  containerId: string | null;
  kind: LinkKind;
  /** One line of the linking text (≤ 120 chars); shape links: the shape's label or "". */
  snippet: string;
  /** UTF-16 [start, end) of the link inside `snippet`. */
  highlights: [number, number][];
};

export type LinksResponse = {
  path: string;
  /** Resolved outgoing links, document order. */
  outgoing: OutLink[];
  /** Outgoing links that resolve to nothing. */
  unresolved: OutLink[];
  /** Grouped by source path (sorted), then document order. */
  backlinks: BackLink[];
  tookMs: number;
};

export type MentionsResponse = {
  path: string;
  /** Text mentioning the drawing's name without linking to it (kind "text"). */
  mentions: BackLink[];
  tookMs: number;
};

export type Resolution = {
  path: string | null;
  /** More than one drawing matched; `path` is the shortest of them. */
  candidates: string[];
};

export type RePointed = {
  path: string;
  target: string;
  from: string | null;
  to: string | null;
};

export type MovePlan = {
  /** Closed drawings that would be rewritten. */
  files: number;
  /** Links that would be rewritten, open drawing included. */
  links: number;
  /** Links that would silently resolve elsewhere after the move: confirm first. */
  rePointed: RePointed[];
};

/**
 * "text" sets `text` and `originalText`; "link" sets the element `link`;
 * "name" sets a frame's `name` (tag rename).
 */
export type ElementEdit = {
  elementId: string;
  field: "text" | "link" | "name";
  value: string;
};

export type MoveResult = {
  /** Echoed by the `links-rewrite-done` event; null when nothing to rewrite. */
  jobId: number | null;
  plannedFiles: number;
  plannedLinks: number;
  /** Edits for the open drawing, applied through the editor (undoable). */
  openDrawingEdits: ElementEdit[];
};

export type RewriteFailure = {
  path: string;
  /** "CONFLICT" (changed on disk: skipped, never overwritten), "IO", "INVALID_FILE". */
  code: string;
  message: string;
};

export type RewriteDone = {
  handle: string;
  jobId: number;
  rewritten: number;
  links: number;
  failed: RewriteFailure[];
  tookMs: number;
};

export type RemeasureSet = {
  /** Path -> text element ids to re-measure when the drawing next opens. */
  paths: Record<string, string[]>;
};

/**
 * The native link index (`vault_links` & co.). `DesktopVaultLinks` bridges to
 * Tauri; `FakeVaultLinks` (src/tests) implements it over FakeVaultRepository
 * for vitest and the Playwright harness.
 */
export interface VaultLinks {
  links(handle: string, path: string): Promise<LinksResponse>;
  unlinkedMentions(
    handle: string,
    path: string,
    limit?: number,
  ): Promise<MentionsResponse>;
  resolve(handle: string, fromPath: string, raw: string): Promise<Resolution>;
  planMove(handle: string, from: string, to: string): Promise<MovePlan>;
  /**
   * Moves/renames `from` to `to` (drawing or folder). `openPath` is the
   * pre-move path of the drawing open in the editor (never rewritten on disk).
   * `rewrite: false` = plain move.
   */
  moveWithLinks(
    handle: string,
    from: string,
    to: string,
    openPath: string | null,
    rewrite: boolean,
  ): Promise<MoveResult>;
  remeasure(handle: string): Promise<RemeasureSet>;
  remeasureDone(handle: string, path: string): Promise<void>;
  /** `links-rewrite-done`; resolves to an unsubscribe function. */
  onRewriteDone(listener: (done: RewriteDone) => void): Promise<() => void>;
  /**
   * Starts search (if pending) and pre-builds the link index once it is
   * ready (`links.start` open or idle). Optional: the first links query
   * builds it otherwise.
   */
  start?(handle: string): Promise<void>;
}

/** `[links]` in config.toml (global). Defaults follow Obsidian. */
export type NewLinkFormat = "shortest" | "relative" | "absolute";
export type ShapeLinkFormat = "wikilink" | "vaultdraw-url";
export type OpenModifier = "mod" | "alt" | "ctrl" | "shift";
export type UpdateOnRename = boolean | "ask";
/** When the hover preview card of a text link shows. */
export type HoverPreview = "always" | "modifier" | "off";
/** `"accent"` (theme accent) or a `#rrggbb` scene colour. */
export type LinkColor = string;

export type LinksSettings = {
  /** links.new_link_format */
  newLinkFormat: NewLinkFormat;
  /** links.shape_link_format */
  shapeLinkFormat: ShapeLinkFormat;
  /** links.open_modifier: held while clicking a text link / shape to open it. */
  openModifier: OpenModifier;
  /** links.update_on_rename */
  updateOnRename: UpdateOnRename;
  /** links.autocomplete: the `[[` popup while editing text. */
  autocomplete: boolean;
  /** links.hint_chars: alphabet for hint letters (Vim/Vimium style). */
  hintChars: string;
  /** links.style_links: draw `[[links]]` in text with the link colour + underline. */
  styleLinks: boolean;
  /** links.color: "accent" (theme accent) or "#rrggbb" (follows dark mode like any stroke). */
  linkColor: LinkColor;
  /** links.hover_preview: preview card of the linked drawing on hover. */
  hoverPreview: HoverPreview;
};

export const DEFAULT_LINKS_SETTINGS: LinksSettings = {
  newLinkFormat: "shortest",
  shapeLinkFormat: "wikilink",
  openModifier: "mod",
  updateOnRename: true,
  autocomplete: true,
  hintChars: "asdfghjkl",
  styleLinks: true,
  linkColor: "accent",
  hoverPreview: "always",
};
