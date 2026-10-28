import type { CommandsApi } from "./commands";
import type { MethodsApi } from "./methods";
import type { Disposable } from "./disposable";
import type { EventsApi } from "./events";
import type { HostApi } from "./host";
import type { ImportersApi } from "./importers";
import type { MarkdownApi } from "./markdown";
import type { MathApi } from "./math";
import type { MenusApi } from "./menus";
import type { PluginManifestInfo } from "./manifest";
import type { PagesApi } from "./pages";
import type { PanelsApi } from "./panels";
import type { SceneContextApi } from "./scene";
import type { SettingsApi } from "./settings";
import type { StatusBarApi } from "./statusBar";
import type { StorageApi } from "./storage";
import type { FoldersApi } from "./folders";
import type { FontsApi, TextApi } from "./text";
import type { ThemeApi } from "./theme";
import type { VaultApi } from "./vault";
import type { ShapesApi } from "./shapes";
import type { DiagramsApi } from "./diagrams";
import type { ThumbnailsApi } from "./thumbnails";
import type { ToolsApi } from "./tools";
import type { OverlaysApi } from "./overlays";
import type { ViewsApi } from "./views";
import type { WorkspaceApi } from "./workspace";

/**
 * Toast messages.
 *
 * @since 0.1.0
 */
export interface UiApi {
  /**
   * Shows a short message, prefixed with the plugin name.
   *
   * @since 0.1.0
   */
  toast(message: string): void;
}

/**
 * Logging; lines go to the console and to the plugin's log.
 *
 * @since 0.1.0
 */
export interface LogApi {
  /** @since 0.1.0 */
  debug(...a: unknown[]): void;
  /** @since 0.1.0 */
  info(...a: unknown[]): void;
  /** @since 0.1.0 */
  warn(...a: unknown[]): void;
  /** @since 0.1.0 */
  error(...a: unknown[]): void;
}

/**
 * What the app hands to `activate`. Everything a plugin registers goes into
 * `subscriptions` and is disposed with the plugin.
 *
 * @since 0.1.0
 */
export interface PluginContext {
  /** @since 0.1.0 */
  readonly manifest: PluginManifestInfo;
  /** @since 0.1.0 */
  readonly commands: CommandsApi;
  /** @since 0.1.0 */
  readonly panels: PanelsApi;
  /** @since 0.1.0 */
  readonly settings: SettingsApi;
  /** @since 0.1.0 */
  readonly ui: UiApi;
  /** @since 0.1.0 */
  readonly log: LogApi;
  /** @since 0.1.0 */
  readonly scene: SceneContextApi;
  /** @since 0.1.0 */
  readonly events: EventsApi;
  /** @since 0.2.0 */
  readonly host: HostApi;
  /** @since 0.2.0 */
  readonly theme: ThemeApi;
  /** @since 0.3.0 */
  readonly storage: StorageApi;
  /** @since 0.6.0 */
  readonly vault: VaultApi;
  /** @since 0.6.0 */
  readonly workspace: WorkspaceApi;
  /** @since 0.6.0 */
  readonly importers: ImportersApi;
  /** @since 0.8.0 */
  readonly markdown: MarkdownApi;
  /** @since 0.8.0 */
  readonly text: TextApi;
  /** @since 0.8.0 */
  readonly fonts: FontsApi;
  /** @since 0.8.0 */
  readonly pages: PagesApi;
  /** @since 0.9.0 */
  readonly folders: FoldersApi;
  /** @since 0.10.0 */
  readonly statusBar: StatusBarApi;
  /** @since 0.11.0 */
  readonly views: ViewsApi;
  /** @since 0.12.0 */
  readonly menus: MenusApi;
  /** Canvas tools declared with `[[contributes.tools]]`. @since 0.15.0 */
  readonly tools: ToolsApi;
  /** Custom shapes declared with `[[contributes.shapes]]`. @since 0.16.0 */
  readonly shapes: ShapesApi;
  /** Methods other programs can call, declared with `[[contributes.methods]]`. Needs the permission `control`. @since 0.22.0 */
  readonly methods: MethodsApi;
  /** The TeX renderer. @since 0.24.0 */
  readonly math: MathApi;
  /** Views that cover the drawing area. @since 0.17.0 */
  readonly overlays: OverlaysApi;
  /** Drawing previews. @since 0.20.0 */
  readonly thumbnails: ThumbnailsApi;
  /** Diagram converters (Mermaid). @since 0.23.0 */
  readonly diagrams: DiagramsApi;
  /**
   * Disposed in reverse order on disable/reload/quit.
   *
   * @since 0.1.0
   */
  readonly subscriptions: Disposable[];
  /**
   * Like `window.setTimeout`; cleared when the plugin is disposed.
   *
   * @since 0.1.0
   */
  setTimeout(fn: () => void, ms: number): Disposable;
  /**
   * Like `window.setInterval`; cleared when the plugin is disposed.
   *
   * @since 0.1.0
   */
  setInterval(fn: () => void, ms: number): Disposable;
}

/**
 * A plugin: the default export of its `main.js`.
 *
 * @since 0.1.0
 */
export interface Plugin {
  /**
   * Called once when the plugin is activated.
   *
   * @since 0.1.0
   */
  activate(ctx: PluginContext): void | Promise<void>;
  /**
   * Called when the plugin is disabled or reloaded. 2 s timeout.
   *
   * @since 0.1.0
   */
  deactivate?(): void | Promise<void>;
}

/**
 * Identity function that types a plugin object. The app has the same function
 * at runtime (import `@vaultdraw/api`).
 *
 * @since 0.1.0
 */
export const definePlugin = (plugin: Plugin): Plugin => plugin;
