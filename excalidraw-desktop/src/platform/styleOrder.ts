/**
 * Keeps the user's own stylesheets (CSS snippets) after the app's generated
 * ones (the theme), so a snippet wins at equal specificity whatever was
 * applied last. App code inserts with adoptBeforeUserSheets /
 * insertStyleBeforeUserStyles; user sheets are marked with markUserSheet /
 * USER_STYLE_ATTR and simply appended.
 */

const userSheets = new WeakSet<CSSStyleSheet>();

/** Attribute on fallback <style> elements that hold user CSS. */
export const USER_STYLE_ATTR = "data-vault-user-style";

export function markUserSheet(sheet: CSSStyleSheet): CSSStyleSheet {
  userSheets.add(sheet);
  return sheet;
}

export const isUserSheet = (sheet: CSSStyleSheet): boolean =>
  userSheets.has(sheet);

/** Adopts `sheet` just before the first user sheet (or last if none). */
export function adoptBeforeUserSheets(
  doc: Document,
  sheet: CSSStyleSheet,
): void {
  const list = doc.adoptedStyleSheets;
  const i = list.findIndex(isUserSheet);
  doc.adoptedStyleSheets =
    i < 0 ? [...list, sheet] : [...list.slice(0, i), sheet, ...list.slice(i)];
}

/** Inserts an app <style> before the first user <style> (or appends). */
export function insertStyleBeforeUserStyles(
  doc: Document,
  style: HTMLStyleElement,
): void {
  const parent = doc.head ?? doc.documentElement;
  const first = parent.querySelector(`:scope > style[${USER_STYLE_ATTR}]`);
  parent.insertBefore(style, first);
}

/**
 * The page's style nonce, if the CSP uses one ("" otherwise). The release
 * CSP keeps style-src 'unsafe-inline' effective (no injected nonce, see
 * tauri.conf.json dangerousDisableAssetCspModification), so <style> elements
 * apply; copying a nonce keeps them working if that ever changes.
 */
export const styleNonce = (doc: Document): string =>
  (doc.querySelector("style[nonce], script[nonce]") as HTMLElement | null)
    ?.nonce ?? "";
