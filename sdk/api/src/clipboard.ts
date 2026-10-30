import type { Disposable } from "./disposable";

/**
 * What a paste handler gets: the plain text that was pasted. Only a paste of text alone reaches
 * a handler (not copied elements or files), and only a handler of a plugin that declares the
 * permission `clipboard`.
 *
 * @since 0.28.0
 */
export interface PasteEvent {
  /** The pasted plain text. @since 0.28.0 */
  readonly text: string;
}

/**
 * Returned by a paste handler: `"handled"` stops the editor's own paste (the plugin dealt with the
 * text); anything else lets the editor paste as usual.
 *
 * @since 0.28.0
 */
export type PasteResult = "handled" | "pass" | void;

/**
 * The clipboard. Needs the permission `clipboard`.
 *
 * @since 0.28.0
 */
export interface ClipboardApi {
  /**
   * The text on the system clipboard (empty when there is none or the system refuses).
   *
   * @since 0.28.0
   */
  readText(): Promise<string>;
  /**
   * Runs for every paste of multi-line plain text, before the editor pastes it. The first handler
   * that returns `"handled"` wins. A handler that throws or takes over 1.5 seconds is skipped.
   * Declare `activation = ["onPaste"]` so the plugin loads on the first such paste and not at start.
   *
   * @since 0.28.0
   */
  onPaste(
    cb: (event: PasteEvent) => PasteResult | Promise<PasteResult>,
  ): Disposable;
}

/**
 * An action button on a toast, such as "Insert as table".
 *
 * @since 0.28.0
 */
export interface ToastOptions {
  /** A button on the toast; it stays about eight seconds. @deprecated Use `actions`: still works in 1.x (the plugin log warns once), removed in 2.0. @since 0.28.0 */
  action?: { label: string; run: () => void };
  /**
   * Up to two buttons (for example "Cancel" or "View report"); replaces `action`.
   * Labels are cut at 40 characters. Clicking one closes the toast and runs it.
   *
   * @since 0.30.0
   */
  actions?: { label: string; run: () => void }[];
  /** One short line under the message, such as the file being worked on. @since 0.30.0 */
  detail?: string;
  /**
   * A progress bar with a count ("12 / 40"). While progress is set the toast
   * stays up as long as you keep updating it (about a minute without an update).
   *
   * @since 0.30.0
   */
  progress?: { done: number; total: number };
  /**
   * Names this notice: showing a toast with the same `id` again updates it in
   * place (new text, bar, buttons) instead of adding another. Use one id for
   * "importing…" and the result that replaces it.
   *
   * @since 0.30.0
   */
  id?: string;
  /** `"error"` gives the toast the error look and keeps it about eight seconds (or the user's notice time). @since 0.30.0 */
  kind?: "info" | "error";
}
