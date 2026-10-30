/**
 * Secrets such as API keys. Needs the permission `secret`. They are kept in a protected file in the
 * app's state folder (readable by this user only; not encrypted), never in `config.toml` or a
 * vault. There is no way to read one back: the app uses it for you (`NetRequest.auth`).
 *
 * @experimental
 * @since 1.1.0
 */
export interface SecretApi {
  /** Stores `value` (1 to 4096 characters) under `name` (lower case letters, digits, `.`, `_`, `-`). @since 1.1.0 */
  set(name: string, value: string): Promise<void>;
  /** Whether a secret is stored under `name`. @since 1.1.0 */
  has(name: string): Promise<boolean>;
  /** Removes the secret. Removing a missing one does nothing. @since 1.1.0 */
  delete(name: string): Promise<void>;
}
