/**
 * Sanitises the reading view's HTML. Markdown can carry raw HTML, so the
 * output of the renderer always passes through DOMPurify before it reaches
 * the page: no scripts, styles, forms, frames or event handlers, and links
 * only to http(s), mailto and in-page addresses. With remote images off
 * (`notes.remote_images`, the default) an image from the web is replaced by
 * its alt text, so opening a note never makes a network request.
 */
import DOMPurify from "dompurify";

export interface SanitizeOptions {
  remoteImages: boolean;
}

const URI =
  /^(?:(?:https?|mailto|vaultdraw|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

let purifier: ReturnType<typeof DOMPurify> | null = null;
let remoteImages = false;

const get = () => {
  if (purifier) {
    return purifier;
  }
  const p = DOMPurify(window);
  p.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") ?? "";
      if (!remoteImages && /^(?:https?:)?\/\//i.test(src)) {
        const alt = node.getAttribute("alt") ?? "";
        const stub = node.ownerDocument.createElement("span");
        stub.className = "note-image-blocked";
        stub.textContent = alt || "Image from the web (turned off)";
        stub.title = src;
        node.replaceWith(stub);
      } else if (
        /^[a-z][a-z0-9+.-]*:/i.test(src) &&
        !/^(?:https?:|blob:|data:image\/)/i.test(src)
      ) {
        node.removeAttribute("src");
      }
    }
    if (node.tagName === "A") {
      const href = node.getAttribute("href") ?? "";
      if (/^https?:/i.test(href)) {
        node.setAttribute("rel", "noopener noreferrer");
        node.setAttribute("data-external", "1");
      }
    }
  });
  purifier = p;
  return p;
};

/** `html` made safe for innerHTML. */
export function sanitizeNoteHtml(
  html: string,
  options: SanitizeOptions,
): string {
  remoteImages = options.remoteImages;
  return get().sanitize(html, {
    ALLOWED_URI_REGEXP: URI,
    FORBID_TAGS: [
      "style",
      "form",
      "iframe",
      "object",
      "embed",
      "link",
      "meta",
      "base",
    ],
    FORBID_ATTR: ["style", "srcset"],
    ADD_ATTR: ["target"],
  }) as string;
}
