import type { ComponentType } from "react";

import type { Disposable } from "./disposable";

/**
 * Panels: provide the React component of a panel declared in `plugin.toml`.
 *
 * @since 0.1.0
 */
export interface PanelsApi {
  /**
   * Provides the React component of a panel declared in plugin.toml (short id).
   *
   * @since 0.1.0
   */
  register(id: string, component: ComponentType): Disposable;
  /**
   * Opens a declared panel (short id).
   *
   * @since 0.1.0
   */
  open(id: string): void;
  /**
   * Closes a declared panel (short id).
   *
   * @since 0.1.0
   */
  close(id: string): void;
}
