import type { Disposable } from "./disposable";

/**
 * Commands: bind handlers of commands declared in `plugin.toml`, or run any
 * command.
 *
 * @since 0.1.0
 */
export interface CommandsApi {
  /**
   * Binds the handler of a command declared in plugin.toml (short id).
   *
   * @since 0.1.0
   */
  register(id: string, run: () => void | Promise<void>): Disposable;
  /**
   * Runs any command by full id (built-in or plugin).
   *
   * @since 0.1.0
   */
  execute(fullId: string): Promise<void>;
}
