import type {
  AppEventMap,
  CommandContribution,
  ImporterContribution,
  Json,
  NewElement,
  PanelContribution,
  PluginContributions,
  PluginPermission,
  SettingDecl,
  SettingValue,
  ThemeMode,
  ThemeTokenName,
} from "@vaultdraw/api";

/**
 * What a test may read about the booted plugin: the manifest after the
 * defaults were filled in.
 */
export interface TestPluginInfo {
  id: string;
  name: string;
  version: string;
  permissions: PluginPermission[];
  /** `data_key` as declared (null: the default `plugins.<id>`; `ctx.manifest.dataKey` has the key in use). */
  dataKey?: string | null;
  contributes: PluginContributions;
}

/**
 * A manifest for `boot`: just an `id` plus what the test cares about.
 * Declared commands and panels may be bare `{ id }`. A full parsed
 * `plugin.toml` is accepted too.
 */
export interface TestManifest {
  id: string;
  name?: string;
  version?: string;
  dir?: string;
  /** `["onStartupFinished"]` activates the plugin during `boot`. */
  activation?: string[];
  /** What the manifest declares. The mock host records it; nothing is gated yet. */
  permissions?: PluginPermission[];
  /** `data_key` of plugin.toml; null or absent means `plugins.<id>`. */
  dataKey?: string | null;
  /** A dev plugin is stopped, not switched off for good, after repeated errors. */
  dev?: boolean;
  contributes?: {
    commands?: (Partial<CommandContribution> & { id: string })[];
    panels?: (Partial<PanelContribution> & { id: string })[];
    settings?: SettingDecl[];
    importers?: (Partial<ImporterContribution> & {
      id: string;
      extensions: string[];
    })[];
  };
}

/** App settings the test sets for the mock host, as a user would in `config.toml`. */
export interface BootOptions {
  /** `plugins.scene_max_ops`: ops per scene batch, 1 to 1000 (default 500), as in the app. */
  sceneMaxOps?: number;
}

/** One line of the plugin's log (`ctx.log` and errors attributed to it). */
export interface PluginLogLine {
  level: "debug" | "info" | "warn" | "error";
  text: string;
}

/** What `openPanel` returns; a Testing Library `RenderResult` fits. */
export interface PanelView {
  /** Removes the panel from the document (its effects are cleaned up). */
  unmount(): void;
}

/** An element as the fake scene holds it (the editor's element shape, the fields tests use). */
export interface FakeElement {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text?: string;
  readonly strokeColor?: string;
  readonly backgroundColor?: string;
  /** Set on the text element that labels a shape. */
  readonly containerId?: string | null;
}

/** A new element, optionally with an id. */
export type FakeElementInput = NewElement & { id?: string };

/** One `scene.batch` write = one undo step. */
export interface FakeBatch {
  captureUpdate?: unknown;
  elements: readonly FakeElement[];
}

/** A minimal editor with one open drawing. */
export interface FakeScene {
  /** Replaces the scene (like a load) and signals a change. */
  setElements(els: readonly FakeElementInput[]): void;
  /**
   * An edit happened: bumps every element version (a scene with no elements
   * has no version to change, so nothing is signalled).
   */
  emitChange(): void;
  /** Another drawing becomes active; null = no drawing open. */
  switchTo(path: string | null): void;
  readOnly(flag: boolean): void;
  /** One entry per `scene.batch` write. */
  readonly batches: FakeBatch[];
  /** Non-deleted elements as the editor holds them. */
  live(): readonly FakeElement[];
  /** Pictures added with image elements, by SHA-1 (the editor's file store). */
  files(): Record<string, { mime: string; bytes: Uint8Array }>;
  /** Ids `ctx.scene.scrollTo` asked the app to focus, in order. */
  scrolledTo(): string[];
  /** The app state fields a page document set (such as `pageSetup`). */
  appState(): Record<string, unknown>;
}

/** The colours a booted plugin reads from `ctx.theme`. */
export interface FakeTheme {
  /**
   * Changes what `ctx.theme` reports and notifies `onChange` listeners.
   * Until a test sets `tokens`, `tokens()` fails with "not set up in this test".
   */
  set(change: {
    mode?: ThemeMode;
    themeId?: string;
    tokens?: Partial<Record<ThemeTokenName, string>>;
  }): void;
}

/** What a booted plugin keeps in `ctx.storage.global` (in memory; writes apply at once). */
export interface FakeStorage {
  /** A copy of the stored object. */
  data(): Record<string, Json>;
  /** Replaces the stored object, as if it had been saved in an earlier run. */
  seed(data: Record<string, Json>): void;
  /** Sets the limit in KiB (default 1024, as `plugins.storage_limit_kb`). */
  setLimitKb(kb: number): void;
}

/** The vault `ctx.vault` sees: in memory, seedable. */
export interface FakeVault {
  /** Replaces every drawing: path to elements. Paths follow the plugin path rules. */
  seed(drawings: Record<string, readonly FakeElementInput[]>): void;
  /** The drawings now (seeded or created by the plugin), by path. */
  drawings(): Record<string, readonly FakeElement[]>;
  /** The open vault; null = no vault is open (`NO_VAULT`). Default: a writable "mock-vault". */
  setVault(info: { name: string; readOnly: boolean } | null): void;
  /** Paths the app saved for a page document (`finish` and `abort`), in order. */
  saves(): string[];
  /** The saved page setup of a drawing (`appState.pageSetup`), or undefined. */
  pageSetup(path: string): Record<string, unknown> | undefined;
}

/** What `ctx.workspace` and `TargetFolder.open()` did. */
export interface FakeWorkspace {
  /** Every `open` call that succeeded. */
  opened(): { path: string; newTab: boolean }[];
  /** Folders opened as a vault by `TargetFolder.open()` (new vaults), as absolute paths. */
  openedVaults(): string[];
  /** Vault folders revealed in the tree by `TargetFolder.open()`. */
  revealed(): string[];
}

/** What `ctx.folders` sees, seedable. */
export interface FakeFolders {
  /** What the next `folders.pickSource` returns (null: the user cancels): files by relative path, text or bytes. */
  setSource(
    folder: { name: string; files: Record<string, string | Uint8Array> } | null,
  ): void;
  /** What the next `pickTarget({ kind: "newVault" })` returns: the vault's name (null: cancelled). */
  setNewVault(name: string | null): void;
  /** Every target handed out, with what was written into it (a vault folder's drawings also show in `vault.drawings()`). */
  targets(): {
    name: string;
    kind: "newVault" | "vaultFolder";
    path: string | null;
    files: Record<string, object | Uint8Array>;
  }[];
}

/** The `events` side of a booted plugin. */
export interface FakeEvents {
  /** Emits an app event as the app would. */
  emit<K extends keyof AppEventMap>(name: K, payload: AppEventMap[K]): void;
}

/** A plugin booted in a test. The real host and the mock host both implement it. */
export interface TestPlugin {
  info: TestPluginInfo;
  /** Runs a command by short id (as the palette does); resolves when its handler is done. */
  run(shortId: string): Promise<void>;
  /** Opens a panel by short id and renders it. */
  openPanel(shortId: string): Promise<PanelView>;
  /** Messages of the visible toasts. */
  toasts(): string[];
  /** Timers the plugin currently has scheduled. */
  timers(): number;
  /** Attributed log lines of this plugin. */
  log(): readonly PluginLogLine[];
  /** Writes a setting; false when the declaration refuses the value or layer. */
  setSetting(
    key: string,
    value: SettingValue,
    scope?: "global" | "vault",
  ): Promise<boolean>;
  scene: FakeScene;
  events: FakeEvents;
  theme: FakeTheme;
  storage: FakeStorage;
  vault: FakeVault;
  workspace: FakeWorkspace;
  folders: FakeFolders;
  /**
   * Drops a file on the drawing as the app does: finds the importer by file
   * extension, loads the plugin, runs it and applies the returned ops as one
   * scene write. Resolves to that write, or null when nothing was applied
   * (no ops, drawing changed, read-only, cancelled, refused). `at` defaults
   * to the viewport centre.
   */
  import(
    fileName: string,
    content: string | Uint8Array,
    at?: { x: number; y: number },
  ): Promise<FakeBatch | null>;
  /** "Import: Cancel": true when an import was running. */
  cancelImport(): boolean;
  /** Lets timers, microtasks and one animation frame run (and React settle). */
  flush(): Promise<void>;
  /** Disables the plugin: `deactivate` runs and everything it registered is disposed. */
  disable(): Promise<void>;
  /** disable + removes everything the kit created. Call it after every test. */
  dispose(): Promise<void>;
}
