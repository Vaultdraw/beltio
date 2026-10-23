/**
 * Puts enabled CSS snippets into the document, one stylesheet per snippet,
 * after everything else so a snippet overrides the theme at equal
 * specificity.
 *
 * Constructed stylesheets (adoptedStyleSheets) are used whenever available:
 * the packaged app's CSP nonce makes injected <style> elements inert, and
 * adopted sheets also cascade after every <style>/<link> in the document,
 * including the theme's override sheet once `keepSnippetsLast` has run.
 * <style data-vault-snippet> elements are the fallback (jsdom).
 *
 * The CSS is applied as written. A sheet that fails to build (it can only
 * throw for non-CSS input) is skipped and reported; it never breaks startup.
 * `@import` is ignored by constructed sheets, and the CSP blocks remote
 * url()s, so a snippet never reaches the network.
 */

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
        sheets.push(sheet);
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
  for (const { id, css } of items) {
    const style = doc.createElement("style");
    style.setAttribute(SNIPPET_ATTR, id);
    style.textContent = css;
    parent.appendChild(style);
  }
  return errors;
}

/**
 * Moves our adopted sheets back to the end if something (the theme) was
 * adopted after them. Cheap no-op when no snippet is applied.
 */
export function keepSnippetsLast(doc: Document): void {
  const ours = adopted.get(doc);
  if (!ours || ours.length === 0) {
    return;
  }
  const list = doc.adoptedStyleSheets;
  const tail = list.slice(list.length - ours.length);
  if (tail.every((s, i) => s === ours[i])) {
    return;
  }
  doc.adoptedStyleSheets = [...list.filter((s) => !ours.includes(s)), ...ours];
}

/** Number of snippet sheets currently applied (tests, diagnostics). */
export function appliedSnippetCount(doc: Document): number {
  return canAdopt(doc)
    ? adopted.get(doc)?.length ?? 0
    : doc.querySelectorAll(`style[${SNIPPET_ATTR}]`).length;
}
