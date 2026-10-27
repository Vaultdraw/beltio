import type { ComponentType } from "react";

import type { Disposable } from "./disposable";

/**
 * The note a view shows. Reading needs the `vault.read` permission, writing needs
 * `vault.write`; without it the call rejects with a `PERMISSION` error.
 *
 * @since 0.11.0
 */
export interface ViewFile {
  /**
   * Reads the note. Keep `revision` and pass it back to `write`.
   *
   * @since 0.11.0
   */
  read(): Promise<{ text: string; revision: string }>;
  /**
   * Saves the note. The app refuses with a `CONFLICT` error when the file changed on disk since
   * `expectedRevision` (an edit in another program), so a view never overwrites newer work. The
   * previous text is kept in the vault's file history. Resolves to the new revision.
   *
   * @since 0.11.0
   */
  write(text: string, expectedRevision: string): Promise<{ revision: string }>;
}

/**
 * What the app gives a view's component.
 *
 * @since 0.11.0
 */
export interface ViewProps {
  /**
   * Vault-relative path of the note in this tab.
   *
   * @since 0.11.0
   */
  path: string;
  /**
   * The note's contents, through the app's guarded file access.
   *
   * @since 0.11.0
   */
  file: ViewFile;
  /**
   * Opens another vault file in the current (`"current"`) or a new (`"new"`) tab.
   *
   * @since 0.11.0
   */
  openPath(path: string, opts?: { target?: "current" | "new" }): void;
}

/**
 * Views: provide the React component of a view declared in plugin.toml
 * (`[[contributes.views]]`). A note whose name ends in one of the view's
 * extensions (for example `kanban.md`) opens in the component instead of the
 * Markdown note view; the plugin loads when the first such tab is shown.
 *
 * @since 0.11.0
 */
export interface ViewsApi {
  /**
   * Provides the component of a declared view (short id).
   *
   * @since 0.11.0
   */
  register(id: string, component: ComponentType<ViewProps>): Disposable;
}
