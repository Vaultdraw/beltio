/**
 * Runtime and types of `@vaultdraw/api` (v0, experimental). Plugins import it
 * through the import map, so every plugin shares this one copy.
 */
import type { ComponentType } from "react";

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
  /** Disposed in reverse order on disable/reload/quit. */
  readonly subscriptions: Disposable[];
  setTimeout(fn: () => void, ms: number): Disposable;
  setInterval(fn: () => void, ms: number): Disposable;
}

export const definePlugin = (plugin: Plugin): Plugin => plugin;
