/**
 * A JSON value: what `ctx.storage` stores. No `undefined`, functions, class
 * instances, `NaN` or `Infinity`.
 *
 * @since 0.3.0
 */
export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

/**
 * A key-value store of JSON values. Every call is async; values come back as
 * fresh copies, so changing one does not change the store.
 *
 * Errors carry a `code`: `QUOTA` when a `set` would pass the limit
 * (`plugins.storage_limit_kb`, 1024 KiB by default), `INVALID_ARGUMENT` for an
 * empty or too long key (over 256 characters) or a value that is not JSON.
 *
 * @since 0.3.0
 */
export interface StorageScope {
  /**
   * The value of `key`, or `undefined` when it has none.
   *
   * @since 0.3.0
   */
  get<T extends Json = Json>(key: string): Promise<T | undefined>;
  /**
   * Stores `value` under `key`. Writes reach the disk debounced (600 ms, at
   * most 2 s later) and before the app quits.
   *
   * @since 0.3.0
   */
  set(key: string, value: Json): Promise<void>;
  /**
   * Removes `key`. Removing a missing key does nothing.
   *
   * @since 0.3.0
   */
  delete(key: string): Promise<void>;
  /**
   * Every key, in insertion order.
   *
   * @since 0.3.0
   */
  keys(): Promise<string[]>;
}

/**
 * Data a plugin keeps between runs.
 *
 * @since 0.3.0
 */
export interface StorageApi {
  /**
   * Data on this computer, the same in every vault: one JSON file in the app's
   * state folder (`plugin-data/<id>/data.json`), never inside a vault and not
   * part of your config files. Uninstalling keeps it; "Plugins: Delete data of
   * a plugin…" deletes it. Nothing is read until the first call.
   *
   * @since 0.3.0
   */
  readonly global: StorageScope;
}
