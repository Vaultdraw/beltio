/**
 * Runtime and types of `@vaultdraw/api` (v0, experimental). Plugins import it
 * through the import map, so every plugin shares this one copy.
 */
import type { ComponentType } from "react";

import type {
  NewElement,
  SceneElement,
  SceneElementType,
  SceneOp,
  SceneOpIssue,
} from "../../sceneOps";
import type { AppEventMap } from "../../events/appEvents";

export type {
  AppEventMap,
  NewElement,
  SceneElement,
  SceneElementType,
  SceneOp,
  SceneOpIssue,
};

export interface Disposable {
  dispose(): void;
}

export interface Plugin {
  activate(ctx: PluginContext): void | Promise<void>;
  /** 2 s timeout. */
  deactivate?(): void | Promise<void>;
}

export interface PluginContext {
  readonly manifest: { id: string; version: string; dir: string };
  readonly commands: {
    /** Bind the handler of a command declared in plugin.toml (short id). */
    register(id: string, run: () => void | Promise<void>): Disposable;
    /** Run any command by full id (built-in or plugin). */
    execute(fullId: string): Promise<void>;
  };
  readonly panels: {
    /** Provide the React component of a panel declared in plugin.toml (short id). */
    register(id: string, component: ComponentType): Disposable;
    open(id: string): void;
    close(id: string): void;
  };
  readonly settings: {
    /** Effective value (vault > global > default). */
    get<T = unknown>(key: string): T;
    set(key: string, value: unknown): Promise<void>;
    onChange(key: string, cb: (value: unknown) => void): Disposable;
  };
  readonly ui: { toast(message: string): void };
  readonly log: {
    debug(...a: unknown[]): void;
    info(...a: unknown[]): void;
    warn(...a: unknown[]): void;
    error(...a: unknown[]): void;
  };
  readonly scene: {
    /** Non-deleted elements of the active drawing (frozen snapshot), [] when none is open. */
    elements(): readonly SceneElement[];
    /** After the active scene changed ("edit") or another drawing became active ("switch"); at most once per frame. */
    onChange(
      cb: (e: { reason: "edit" | "switch"; path: string | null }) => void,
    ): Disposable;
    /** React hook: `select(elements)`, re-rendered only when the selected value changes (`isEqual`, default Object.is). */
    useScene<T>(
      select: (els: readonly SceneElement[]) => T,
      isEqual?: (a: T, b: T) => boolean,
    ): T;
    /** Applies the ops as ONE undo step. Rejects: no drawing, read-only, invalid ops. */
    batch(ops: readonly SceneOp[]): Promise<{ ids: string[] }>;
    /** Centre of the visible canvas in scene coordinates. */
    viewportCenter(): { x: number; y: number };
  };
  readonly events: {
    /** App events (vault-relative paths). Delivery is async and ordered per event. */
    on<K extends keyof AppEventMap>(
      name: K,
      cb: (payload: Readonly<AppEventMap[K]>) => void,
    ): Disposable;
  };
  /** Disposed in reverse order on disable/reload/quit. */
  readonly subscriptions: Disposable[];
  setTimeout(fn: () => void, ms: number): Disposable;
  setInterval(fn: () => void, ms: number): Disposable;
}

export const definePlugin = (plugin: Plugin): Plugin => plugin;
