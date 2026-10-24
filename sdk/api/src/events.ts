import type { Disposable } from "./disposable";

/**
 * Typed app events for plugins. Paths are vault-relative, never absolute.
 *
 * @since 0.1.0
 */
export type AppEventMap = {
  "vault.opened": { name: string };
  "drawing.opened": { path: string };
  "drawing.saved": { path: string };
  "drawing.renamed": { from: string; to: string };
  "drawing.deleted": { path: string };
  /**
   * Files in the vault changed on disk (a plugin's own writes and autosaves
   * included, so compare revisions). `rescan` is true when the watcher lost
   * track and every path may have changed. Needs `vault.read`.
   *
   * @since 0.6.0
   */
  "vault.changed": { paths: string[]; rescan: boolean };
};

/**
 * Subscribe to app events.
 *
 * @since 0.1.0
 */
export interface EventsApi {
  /**
   * App events (vault-relative paths). Delivery is async and ordered per event.
   *
   * @since 0.1.0
   */
  on<K extends keyof AppEventMap>(
    name: K,
    cb: (payload: Readonly<AppEventMap[K]>) => void,
  ): Disposable;
}
