/**
 * Puts enabled CSS snippets into the document, one stylesheet per snippet,
 * after the app's own sheets so a snippet overrides the theme at equal
 * specificity. The theme inserts its sheet before user sheets
 * (platform/styleOrder.ts), so the order holds whatever is applied last.
 *
 * Constructed stylesheets (adoptedStyleSheets, WebKit 16.4+) are used when
 * available. Older WebKit gets <style> elements, which apply under the
 * release CSP (style-src keeps 'unsafe-inline'; a nonce is copied if the
 * page has one), so neither path is a silent no-op.
 *
 * The CSS is applied as written. A sheet that fails to build is skipped and
 * reported; it never breaks startup. `@import` is ignored by constructed
 * sheets, and the CSP blocks remote url()s, so a snippet never reaches the
 * network.
 */
import {
  markUserSheet,
  styleNonce,
  USER_STYLE_ATTR,
} from "../platform/styleOrder";

export interface SnippetCss {
  id: string;
  css: string;
}

const SNIPPET_ATTR = "data-vault-snippet";

/** Our adopted sheets per document, in apply order. */
const adopted = new WeakMap<Document, CSSStyleSheet[]>();

const canAdopt = (doc: Document): boolean => {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  return (
    !!win &&
    Array.isArray(doc.adoptedStyleSheets) &&
    typeof win.CSSStyleSheet === "function" &&
    typeof win.CSSStyleSheet.prototype.replaceSync === "function"
  );
};

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/**
 * Replaces the applied snippets with `items` (in order). Returns per-snippet
 * errors (id -> message). An empty list removes everything we added.
 */
export function applySnippetCss(
  doc: Document,
  items: readonly SnippetCss[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (canAdopt(doc)) {
    const win = doc.defaultView as Window & typeof globalThis;
    const previous = adopted.get(doc) ?? [];
    const sheets: CSSStyleSheet[] = [];
    for (const { id, css } of items) {
      try {
        const sheet = new win.CSSStyleSheet();
        sheet.replaceSync(css);
        sheets.push(markUserSheet(sheet));
      } catch (err) {
        errors[id] = errorText(err);
      }
    }
    if (previous.length === 0 && sheets.length === 0) {
      return errors;
    }
    const others = doc.adoptedStyleSheets.filter((s) => !previous.includes(s));
    doc.adoptedStyleSheets = [...others, ...sheets];
    if (sheets.length > 0) {
      adopted.set(doc, sheets);
    } else {
      adopted.delete(doc);
    }
    return errors;
  }
  doc.querySelectorAll(`style[${SNIPPET_ATTR}]`).forEach((el) => el.remove());
  const parent = doc.head ?? doc.documentElement;
  const nonce = items.length > 0 ? styleNonce(doc) : "";
  for (const { id, css } of items) {
    const style = doc.createElement("style");
    style.setAttribute(SNIPPET_ATTR, id);
    style.setAttribute(USER_STYLE_ATTR, "");
    if (nonce) {
      style.nonce = nonce;
    }
    style.textContent = css;
    parent.appendChild(style);
  }
  return errors;
}

/** Number of snippet sheets currently applied (tests, diagnostics). */
export function appliedSnippetCount(doc: Document): number {
  return canAdopt(doc)
    ? adopted.get(doc)?.length ?? 0
    : doc.querySelectorAll(`style[${SNIPPET_ATTR}]`).length;
}
