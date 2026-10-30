/**
 * Where to scroll in a note after a `[[Note#Heading]]` or `[[Note#^block]]`
 * link opens it. The link handler queues the anchor for the target path; the
 * note's view takes it once the reading view is drawn. Nothing exists until a
 * link with an anchor is clicked.
 */
export interface NoteAnchor {
  heading?: string;
  block?: string;
}

const pending = new Map<string, NoteAnchor>();
const listeners = new Set<() => void>();

export function queueAnchor(path: string, anchor: NoteAnchor): void {
  pending.set(path, anchor);
  listeners.forEach((l) => l());
}

export function takeAnchor(path: string): NoteAnchor | null {
  const a = pending.get(path) ?? null;
  pending.delete(path);
  return a;
}

export const hasAnchor = (path: string): boolean => pending.has(path);

export function onAnchorQueued(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`*_~=]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The element of the reading view an anchor points at, or null. */
export function findAnchorElement(
  root: ParentNode,
  anchor: NoteAnchor,
): HTMLElement | null {
  if (anchor.block) {
    const marker = ` ^${anchor.block}`;
    for (const el of root.querySelectorAll<HTMLElement>("p, li")) {
      let own = el;
      if (el.tagName === "LI" && el.querySelector("ul, ol")) {
        // A list item's own text, not its nested items'.
        own = el.cloneNode(true) as HTMLElement;
        own.querySelectorAll("ul, ol").forEach((n) => n.remove());
      }
      if (
        own.querySelector(`[data-block-id="${CSS.escape(anchor.block)}"]`) ||
        ` ${(own.textContent ?? "").trimEnd()}`.endsWith(marker)
      ) {
        // An id on a line of its own names the table, quote or list above it (Obsidian).
        const alone =
          el.tagName === "P" &&
          (el.textContent ?? "").trim().replace(marker.trim(), "") === "";
        return (alone && (el.previousElementSibling as HTMLElement)) || el;
      }
    }
    return null;
  }
  if (anchor.heading) {
    const byId = root.querySelector<HTMLElement>(
      `[id="${CSS.escape(slug(anchor.heading))}"]`,
    );
    if (byId) {
      return byId;
    }
    const want = plain(anchor.heading);
    for (const h of root.querySelectorAll<HTMLElement>(
      "h1, h2, h3, h4, h5, h6",
    )) {
      if (plain(h.textContent ?? "") === want) {
        return h;
      }
    }
  }
  return null;
}
