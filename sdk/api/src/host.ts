/**
 * Which API level and revision this app implements.
 *
 * @since 0.2.0
 */
export interface ApiVersion {
  /** The API level: 1 since API 1.0. It changes only in a major release. A plugin that says `api = 0` still loads until 2.0. @since 0.2.0 */
  level: 1;
  /** The revision within the level, a semantic version such as `1.2.0`: minor for additions, patch for fixes. @since 0.2.0 */
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
