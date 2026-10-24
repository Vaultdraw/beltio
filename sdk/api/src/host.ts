/**
 * Which API level and revision this app implements.
 *
 * @since 0.2.0
 */
export interface ApiVersion {
  /** The API level. 0 is experimental. @since 0.2.0 */
  level: 0;
  /** The revision within the level, such as `0.2.0`. It rises with every addition. @since 0.2.0 */
  revision: string;
}

/**
 * Facts about the app that runs the plugin, and a way to ask "can I use this?".
 *
 * @since 0.2.0
 */
export interface HostApi {
  /**
   * The app version, such as `0.1.2`.
   *
   * @since 0.2.0
   */
  readonly app: string;
  /**
   * The API this app implements.
   *
   * @since 0.2.0
   */
  readonly api: ApiVersion;
  /**
   * Whether this app has a feature, by name: a `ctx` member (`"theme"`,
   * `"theme.tokens"`, `"scene.batch"`) or an app event (`"drawing.saved"`).
   * Ask for the feature, not the version, and fall back when it is missing.
   * The names are generated from the `@since` tags; unknown names give false.
   *
   * @since 0.2.0
   */
  has(feature: string): boolean;
}
