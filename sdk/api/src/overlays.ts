import type { ComponentType } from "react";

import type { Disposable } from "./disposable";

/**
 * What the app gives an overlay's component.
 *
 * @since 0.17.0
 */
export interface OverlayProps {
  /** Closes the overlay and gives focus back to the drawing. @since 0.17.0 */
  close(): void;
}

/**
 * Options of `ctx.overlays.open`.
 *
 * @since 0.17.0
 */
export interface OverlayOptions {
  /**
   * Runs once when the overlay closes for any reason: `close()`, `dispose()`, the user opening
   * another overlay or a tab, or the plugin stopping.
   *
   * @since 0.17.0
   */
  onClose?(): void;
  /**
   * A dialog: the drawing stays visible and usable behind it (no cover, no freeze), and the
   * component draws its own scrim and frame. Default false (a view that covers the drawing area).
   *
   * @since 0.24.0
   */
  modal?: boolean;
}

/**
 * The open overlay. `dispose()` closes it, like `close()`.
 *
 * @since 0.17.0
 */
export interface OverlayHandle extends Disposable {
  /** Closes the overlay; does nothing when it is already closed. @since 0.17.0 */
  close(): void;
  /** True until the overlay closes. @since 0.17.0 */
  readonly isOpen: boolean;
}

/**
 * A view that covers the whole drawing area (a graph, a gallery) while the editor stays loaded
 * but frozen behind it. One overlay is open at a time: opening one closes the previous, and the
 * app's own graph and gallery. There is nothing to declare in plugin.toml; call `open` from a
 * command the user ran.
 *
 * @since 0.17.0
 */
export interface OverlaysApi {
  /**
   * Shows `component` over the drawing area. The component is wrapped in an error boundary;
   * a crash shows "This plugin overlay crashed." and is attributed to the plugin.
   *
   * @since 0.17.0
   */
  open(
    component: ComponentType<OverlayProps>,
    options?: OverlayOptions,
  ): OverlayHandle;
}
