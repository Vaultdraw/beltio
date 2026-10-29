/**
 * Pictures from the web, for a plugin that shows notes with web images. Needs the permission
 * `network.images`. Web pictures are on unless the user turned them off (`network.allow_images =
 * false`) or switched the network off; nothing is asked. Every download is http or https to a
 * public host (never a private or local address, also after redirects), at most 10 MiB, and must be
 * a picture (PNG, JPEG, GIF, WebP or SVG) by its bytes.
 *
 * @since 0.31.0
 */
export interface NetworkApi {
  /**
   * Whether pictures from the sites of `urls` may be downloaded: `true` unless the user turned web
   * pictures off or switched the network off. No dialog is shown (since 2026-10-29; before, the
   * app asked once).
   *
   * @since 0.31.0
   */
  askImages(urls: readonly string[]): Promise<boolean>;
  /**
   * The bytes of the picture at an http or https `url`. Rejects with `NETWORK_NOT_ALLOWED` (web
   * pictures turned off) or `NETWORK_DISABLED` (network off), `INVALID_URL`, `REDIRECT_REFUSED`,
   * `PRIVATE_ADDRESS`, `TOO_LARGE`, `NOT_AN_IMAGE`, `HTTP_STATUS`, `NETWORK_TIMEOUT` or
   * `NETWORK_ERROR`.
   *
   * @since 0.31.0
   */
  fetchImage(url: string): Promise<Uint8Array>;
}
