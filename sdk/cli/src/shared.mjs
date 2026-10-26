/**
 * Bare modules a plugin may import; the app serves each from its own copy.
 * A copy of `SHARED_SPECIFIERS` in `sdk/api/src/specifiers.ts`, kept here so the
 * command line has no dependency. A test asserts the two lists are equal.
 */
export const SHARED_SPECIFIERS = [
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
