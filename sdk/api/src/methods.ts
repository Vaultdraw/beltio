import type { Disposable } from "./disposable";
import type { Json } from "./storage";

/**
 * Methods other programs can call: declared in plugin.toml (`[[contributes.methods]]`, permission
 * `control`). The `vaultdraw plugin call` command, scripts on the control socket and, for a
 * method with `mcp = true` while the user has AI turned on, AI apps reach them. The plugin
 * loads on the first call; nothing runs until then.
 *
 * @since 0.22.0
 */
export interface MethodsApi {
  /**
   * Binds the handler of a method declared in plugin.toml. It gets the caller's JSON params
   * (`{}` when none) and returns JSON, or a promise of it. A throw, a result that is not JSON,
   * or an answer later than the method's `timeout_ms` (default 30 s) fails the call with a
   * message the caller sees.
   *
   * @since 0.22.0
   */
  register(
    name: string,
    handler: (params: Json) => Json | Promise<Json>,
  ): Disposable;
}
