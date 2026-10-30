/**
 * One request to an internet address (or to this computer), sent by the app, not by the page: the
 * page's content policy allows no `fetch`. Needs the permission `net`.
 *
 * Rules: https only, except http to this computer (`localhost`, `127.0.0.1`, `::1`); no private or
 * local network address; no redirects; at most 2 MiB sent and 8 MiB received; at most 4 requests
 * open at once. While Offline mode is on, a request to another computer fails with
 * `NETWORK_DISABLED`, and a request to this computer still works (it never leaves the machine).
 *
 * @experimental
 * @since 1.1.0
 */
export interface NetRequest {
  /** @since 1.1.0 */
  url: string;
  /** Default `POST` when there is a `body`, else `GET`. @since 1.1.0 */
  method?: "GET" | "POST";
  /** Plain header names and values. `Host`, `Cookie`, `Content-Length` and `Proxy-*` are refused. @since 1.1.0 */
  headers?: Record<string, string>;
  /** @since 1.1.0 */
  body?: string;
  /** Milliseconds to connect and to wait for more data, 1000 to 600000 (default 60000). @since 1.1.0 */
  timeoutMs?: number;
  /**
   * Adds the header `header` = `prefix` + the stored secret `secret` (see `ctx.secret`). The page
   * never sees the secret. Fails with `SECRET_MISSING` when none is stored.
   *
   * @since 1.1.0
   */
  auth?: { secret: string; header: string; prefix?: string };
}

/**
 * The answer to a `NetRequest`. A status outside 200 to 299 is not an error: read the body for the
 * provider's message.
 *
 * @experimental
 * @since 1.1.0
 */
export interface NetResponse {
  /** @since 1.1.0 */
  readonly status: number;
  /** True for 200 to 299. @since 1.1.0 */
  readonly ok: boolean;
  /** The body as it arrives. Throws a coded error when the connection breaks. @since 1.1.0 */
  readonly body: AsyncIterable<Uint8Array>;
  /** The whole body as text. @since 1.1.0 */
  text(): Promise<string>;
  /** Stops the transfer. Safe to call twice. @since 1.1.0 */
  close(): void;
}

/**
 * Requests to the internet. Error codes: `NETWORK_DISABLED`, `NETWORK_NOT_ALLOWED`, `INVALID_URL`,
 * `PRIVATE_ADDRESS`, `NETWORK_TIMEOUT`, `NETWORK_ERROR`, `TOO_LARGE`, `TOO_MANY_STREAMS`,
 * `SECRET_MISSING`, `ABORTED`.
 *
 * @experimental
 * @since 1.1.0
 */
export interface NetApi {
  /**
   * Sends the request and resolves when the answer's headers arrive. `signal` aborts the request
   * (rejects with `ABORTED`, or ends the body with that error).
   *
   * @since 1.1.0
   */
  request(
    request: NetRequest,
    options?: { signal?: AbortSignal },
  ): Promise<NetResponse>;
}
