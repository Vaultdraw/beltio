/**
 * Command registry contract (Settings phase 3). Commands are static metadata
 * (`commands.ts`); their handlers are bound at runtime by the app shell, so
 * settings sync, the Hotkeys page and the quick switcher can use the list
 * without React or VaultApp.
 */

/** Categories the app ships; plugins may add their own. */
export type BuiltinCommandCategory =
  | "File"
  | "Vault"
  | "View"
  | "Navigator"
  | "Settings"
  | "Appearance"
  | "Palette"
  | "Pens"
  | "Tool defaults"
  | "Export"
  | "Templates"
  | "Tags"
  | "Paper"
  | "Page"
  | "Library"
  | "Links"
  | "History"
  | "Graph"
  | "Formula"
  | "Thumbnails"
  | "Tabs";

export type CommandCategory = BuiltinCommandCategory | (string & {});

/**
 * Facts the dispatcher checks before claiming a key.
 * - vaultOpen: a vault is open.
 * - drawingOpen: a drawing is open in the editor.
 * - writable: the vault is not read-only.
 * - textEditing: focus is in an input, textarea, select or contenteditable
 *   (includes Excalidraw's WYSIWYG text editor).
 * - canvasFocus: focus is inside the editor and not text editing.
 * - modalOpen: a vault dialog (`.vault-modal-backdrop`) is open.
 */
export type BuiltinContextKey =
  | "vaultOpen"
  | "drawingOpen"
  | "writable"
  | "textEditing"
  | "canvasFocus"
  | "modalOpen";

/** Plugins add namespaced keys (`ns.name`, see contextKeys.ts). */
export type ContextKey = BuiltinContextKey | `${string}.${string}`;

/** `"!modalOpen"` = must not hold. All entries of `when` must hold. */
export type WhenClause = ContextKey | `!${ContextKey}`;

export type Platform = "mac" | "win" | "linux";

/**
 * A chord in config notation: modifiers then a `KeyboardEvent.code`-based key
 * name, joined by "+", e.g. "Mod+Shift+Equal", "Mod+Comma", "F2", "Alt+N".
 * `Mod` = Cmd on macOS, Ctrl elsewhere. Canonical modifier order:
 * Mod, Ctrl, Alt, Shift, Meta (see keys.ts).
 */
export type Chord = string;

export interface CommandKeys {
  /** Used when the platform has no entry of its own. [] = unassigned. */
  default: Chord[];
  mac?: Chord[];
  win?: Chord[];
  linux?: Chord[];
}

export interface CommandDefinition {
  /** "namespace.camelCase", stable: it is the key in `[hotkeys]`. */
  id: string;
  title: string;
  category: CommandCategory;
  keys: CommandKeys;
  when?: WhenClause[];
  /**
   * Run again on auto-repeat keydowns while the key is held (e.g. zoom).
   * Default false: a held key is still claimed but runs once.
   */
  repeat?: boolean;
  /** Listed in the palette's commands mode (default true). */
  palette?: boolean;
  /**
   * A former id of this command: its `[hotkeys]` entry applies while this id
   * has none, minus `except` (chords that moved to another command), so
   * existing configs keep working after a rename or split.
   */
  legacy?: { id: string; except?: Chord[] };
}

/** Live context snapshot the dispatcher evaluates `when` against. */
export type CommandContext = Readonly<Record<BuiltinContextKey, boolean>>;

export type CommandHandler = () => void | Promise<void>;

/** Handlers bound by the app shell; a command without one is unavailable. */
export type CommandHandlers = Partial<Record<string, CommandHandler>>;

/** `[hotkeys]` overrides: command id -> chords. [] = unassigned. */
export type HotkeyOverrides = Readonly<Record<string, readonly Chord[]>>;
