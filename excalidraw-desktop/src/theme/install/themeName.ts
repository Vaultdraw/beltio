/**
 * Theme-name rules: the TypeScript twin of `sanitize_name` in src-tauri/src/theme_install.rs. Both
 * are pinned by one case table (vaultdraw-core/src/contract/theme_names.json), so Look up never
 * accepts a name the install refuses, nor the other way round.
 */

export const MAX_THEME_NAME_CHARS = 80;
/** The folder named after the theme must fit a file name. */
const MAX_THEME_NAME_BYTES = 255;

// Invisible and text-direction characters: `is_bidi` in vaultdraw-core/src/uri.rs.
const INVISIBLE =
  // eslint-disable-next-line no-misleading-character-class
  /[­؀-؅؜۝܏࣢᠎​-‏‪-‮⁠-⁤⁦-⁯﻿￹-￻\u{110BD}\u{1D173}-\u{1D17A}\u{E0001}\u{E0020}-\u{E007F}]/u;
const FILE_NAME_CHARS = /[/\\:*?"<>|]/;

/** Why a theme cannot have this name, in plain words; null when it can. */
export const themeNameProblem = (name: string): string | null => {
  if (!name || name.trim() !== name) {
    return "The name is empty or has spaces around it";
  }
  if (Array.from(name).length > MAX_THEME_NAME_CHARS) {
    return `The name is too long (${MAX_THEME_NAME_CHARS} characters at most)`;
  }
  if (new TextEncoder().encode(name).length > MAX_THEME_NAME_BYTES) {
    return "The name is too long to be a file name (emoji and accented letters take more room)";
  }
  if (name.startsWith(".") || name.toLowerCase() === "source") {
    return "This name is not allowed";
  }
  if (
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f-\u009f]/.test(name) ||
    INVISIBLE.test(name) ||
    FILE_NAME_CHARS.test(name)
  ) {
    return "The name has characters that are not allowed (file-name, invisible or text-direction characters)";
  }
  return null;
};
