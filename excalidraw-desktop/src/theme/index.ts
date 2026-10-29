/**
 * Theme engine public API.
 *
 *   const theme = await loadBuiltinTheme("nord");  // parsed once
 *   // (getBuiltinTheme(id) answers synchronously once loaded, and for Default)
 *   const variant = theme[mode];
 *   const tokens = deriveTokens(variant, mode);
 *   const handle = applyThemeTokens(document, tokens,
 *     excalidrawVariableOverrides(tokens, mode));
 *   // later: handle.restore();
 */

import {
  adoptBeforeUserSheets,
  insertStyleBeforeUserStyles,
} from "../platform/styleOrder";

export * from "./types";
export * from "./color";
export {
  parseThemeFile,
  resolveVariant,
  generateVariant,
  slugify,
} from "./normalize";
export { applyAccent, normalizeAccent, resolveAccent } from "./accent";
export type { ResolvedAccent } from "./accent";
export {
  ACCENT_TEXT_MAX_NUDGE,
  CONTRAST,
  NON_HEX_TOKENS,
  STATE_ALPHA,
  deriveTokens,
} from "./tokens";
export { excalidrawVariableOverrides } from "./excalidrawVars";
export {
  MARKDOWN_ROLES,
  MARKDOWN_TEXT_CONTRAST,
  deriveMarkdownColors,
  markdownColors,
  markdownToken,
} from "./markdown";
export type { MarkdownColors, MarkdownRole } from "./markdown";
export {
  buildCanvasColorTransform,
  buildCanvasPaletteMap,
  resolveFamilyTargets,
  HUE_FAMILIES,
} from "./canvas";
export {
  DEFAULT_THEME_ID,
  EAGER_THEME_IDS,
  builtinThemeFiles,
  builtinThemePreview,
  getBuiltinTheme,
  isBuiltinThemeLoaded,
  loadBuiltinTheme,
  loadBuiltinThemes,
  previewFromTheme,
  previewFromVariant,
} from "./builtins";
export type {
  BuiltinOrigin,
  BuiltinThemeFile,
  ThemePreview,
  ThemePreviewColors,
} from "./builtins";

/** id of the fallback <style> element carrying Excalidraw variable overrides. */
export const EXCALIDRAW_OVERRIDE_STYLE_ID = "vault-theme-excalidraw-vars";

export type AppliedTheme = {
  /** Inline values on <html> before this call ("" = was not set). */
  previous: Record<string, string>;
  /** Restores the previous inline values and removes the override stylesheet. */
  restore: () => void;
};

/** Constructed stylesheets per document (CSP-safe path, see below). */
const constructedSheets = new WeakMap<Document, CSSStyleSheet>();

const canAdoptStyleSheets = (doc: Document) => {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  return (
    !!win &&
    Array.isArray(doc.adoptedStyleSheets) &&
    typeof win.CSSStyleSheet === "function" &&
    typeof win.CSSStyleSheet.prototype.replaceSync === "function"
  );
};

/**
 * Writes the Excalidraw override CSS and returns a function restoring the
 * previous state.
 *
 * The packaged app's CSP carries a style nonce, which disables
 * 'unsafe-inline', so an injected <style> element is silently ignored there.
 * Constructed stylesheets (adoptedStyleSheets) are not subject to style-src,
 * so they are used whenever available; the <style> element remains as a
 * fallback for environments without them (jsdom in unit tests).
 */
const writeOverrideCss = (doc: Document, css: string): (() => void) => {
  if (canAdoptStyleSheets(doc)) {
    const win = doc.defaultView as Window & typeof globalThis;
    let sheet = constructedSheets.get(doc);
    const added = !sheet;
    const previousCss = sheet
      ? Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n")
      : "";
    if (!sheet) {
      sheet = new win.CSSStyleSheet();
      constructedSheets.set(doc, sheet);
      adoptBeforeUserSheets(doc, sheet);
    }
    sheet.replaceSync(css);
    const current = sheet;
    return () => {
      if (added) {
        doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(
          (s) => s !== current,
        );
        constructedSheets.delete(doc);
      } else {
        current.replaceSync(previousCss);
      }
    };
  }

  let style = doc.getElementById(
    EXCALIDRAW_OVERRIDE_STYLE_ID,
  ) as HTMLStyleElement | null;
  const previousCss = style ? style.textContent : null;
  if (!style) {
    style = doc.createElement("style");
    style.id = EXCALIDRAW_OVERRIDE_STYLE_ID;
    insertStyleBeforeUserStyles(doc, style);
  }
  style.textContent = css;
  const styleEl = style;
  return () => {
    if (previousCss === null) {
      styleEl.remove();
    } else {
      styleEl.textContent = previousCss;
    }
  };
};

/**
 * Sets every token and Excalidraw variable as an inline custom property on
 * `doc.documentElement`.
 *
 * Excalidraw re-declares its variables on `.excalidraw` /
 * `.excalidraw.theme--dark`, which beats inheritance from <html>, so the
 * Excalidraw variables are additionally written to a stylesheet whose
 * selectors (`:root .excalidraw`, `:root .excalidraw.theme--dark`) out-rank
 * theme.scss. Calling it again replaces that stylesheet's contents.
 */
export const applyThemeTokens = (
  doc: Document,
  tokens: Record<string, string>,
  excalidrawVars: Record<string, string>,
): AppliedTheme => {
  const root = doc.documentElement;
  const previous: Record<string, string> = {};
  const all = { ...tokens, ...excalidrawVars };
  for (const [name, value] of Object.entries(all)) {
    previous[name] = root.style.getPropertyValue(name);
    root.style.setProperty(name, value);
  }

  const body = Object.entries(excalidrawVars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  const restoreCss = writeOverrideCss(
    doc,
    `:root .excalidraw,\n:root .excalidraw.theme--dark {\n${body}\n}\n`,
  );

  return {
    previous,
    restore: () => {
      for (const [name, value] of Object.entries(previous)) {
        if (value) {
          root.style.setProperty(name, value);
        } else {
          root.style.removeProperty(name);
        }
      }
      restoreCss();
    },
  };
};
