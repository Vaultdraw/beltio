/**
 * Pictures from the web, for a plugin that shows notes with web images. Needs the permission
 * `network.images`. The app asks the user in its own dialog (the page cannot click it), once, and
 * remembers the answer; every download is https only, never reaches a private or local address,
 * is at most 10 MiB and must be a picture (PNG, JPEG, GIF, WebP or SVG) by its bytes.
 *
 * @since 0.31.0
 */
export interface NetworkApi {
  /**
   * Asks the user to allow downloading pictures from the sites of `urls`, unless they already did.
   * Resolves `true` when downloading is allowed, `false` when the user said no (nothing is
   * asked again for a "no" within one run of the plugin: ask once per import).
   *
   * @since 0.31.0
   */
  askImages(urls: readonly string[]): Promise<boolean>;
  /**
   * The bytes of the picture at an https `url`. Rejects with `NETWORK_NOT_ALLOWED` or
   * `NETWORK_DISABLED` (not allowed, ask first), `INVALID_URL`, `REDIRECT_REFUSED`,
   * `PRIVATE_ADDRESS`, `TOO_LARGE`, `NOT_AN_IMAGE`, `HTTP_STATUS`, `NETWORK_TIMEOUT` or
   * `NETWORK_ERROR`.
   *
   * @since 0.31.0
   */
  fetchImage(url: string): Promise<Uint8Array>;
}
