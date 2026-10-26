/**
 * Bare modules a plugin may import; the app serves each from its own copy.
 * Anything else must be bundled into `main.js`.
 *
 * @since 0.1.0
 */
export const SHARED_SPECIFIERS: readonly string[] = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@vaultdraw/api",
  "@codemirror/state",
  "@codemirror/view",
  "@codemirror/language",
  "@codemirror/commands",
  "@lezer/common",
  "@lezer/highlight",
];
