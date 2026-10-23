/**
 * Something a plugin can release.
 *
 * @since 0.1.0
 */
export interface Disposable {
  /**
   * Releases the resource. Calling it twice is harmless.
   *
   * @since 0.1.0
   */
  dispose(): void;
}
