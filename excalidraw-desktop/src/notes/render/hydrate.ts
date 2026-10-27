/**
 * Work done on the sanitised DOM after it is on the page: formulas (the
 * formula renderer, a worker running MathJax, loaded on the first formula),
 * and embeds (`![[note]]`, `![[image.png]]`) filled in from the vault. None of
 * it runs for a note without those parts.
 */
import { extractBlock, extractSection } from "./sections";

export interface EmbedDeps {
  /** Text of a vault note, or null when it cannot be read. */
  noteText: (path: string) => Promise<string | null>;
  /** A URL an <img> can show for a vault image, or null. */
  imageUrl: (path: string) => Promise<string | null>;
  /** Sanitised HTML of a nested note; `depth` counts nesting. */
  renderNested: (text: string, depth: number) => string;
  /** Hydrates the nested element (formulas, deeper embeds). */
  afterNested: (el: HTMLElement, depth: number) => Promise<void>;
}

const MAX_DEPTH = 2;

const toHex = (css: string): string => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  if (!m) {
    return "#1e1e1e";
  }
  return `#${[m[1], m[2], m[3]]
    .map((n) => Number(n).toString(16).padStart(2, "0"))
    .join("")}`;
};

/** Replaces each `[data-math]` element's text with the rendered formula. */
export async function hydrateMath(
  root: HTMLElement,
  fontPx: number,
): Promise<void> {
  const nodes = [...root.querySelectorAll<HTMLElement>("[data-math]")];
  if (nodes.length === 0) {
    return;
  }
  const [{ renderFormula }, { svgToDataURL, FONT_PX }] = await Promise.all([
    import("../../formula/renderer"),
    import("../../formula/svgPost"),
  ]);
  const color = toHex(getComputedStyle(root).color);
  await Promise.all(
    nodes.map(async (el) => {
      const source = el.dataset.math ?? "";
      const display = el.dataset.display === "1";
      const result = await renderFormula({ source, display, color });
      if (!root.isConnected || !el.isConnected) {
        return;
      }
      if (!result.ok) {
        el.classList.add("note-math-error");
        el.title = result.error;
        return;
      }
      const img = document.createElement("img");
      img.className = "note-math-img";
      img.alt = source;
      img.src = svgToDataURL(result.svg);
      const k = fontPx / FONT_PX;
      img.width = Math.round(result.width * k * 100) / 100;
      img.height = Math.round(result.height * k * 100) / 100;
      el.replaceChildren(img);
    }),
  );
}

/** Fills the `[data-embed]` placeholders of `root`. */
export async function hydrateEmbeds(
  root: HTMLElement,
  deps: EmbedDeps,
  depth = 0,
): Promise<void> {
  const nodes = [...root.querySelectorAll<HTMLElement>("[data-embed]")];
  await Promise.all(
    nodes.map(async (el) => {
      const path = el.dataset.path;
      if (!path) {
        return;
      }
      if (el.dataset.embed === "image") {
        const url = await deps.imageUrl(path);
        if (!url || !el.isConnected) {
          return;
        }
        const img = document.createElement("img");
        img.className = "note-embed-img";
        img.alt = el.dataset.target ?? "";
        img.src = url;
        const size = /^(\d+)(?:x(\d+))?$/.exec(el.dataset.alias ?? "");
        if (size) {
          img.width = Number(size[1]);
          if (size[2]) {
            img.height = Number(size[2]);
          }
        }
        el.replaceChildren(img);
        return;
      }
      if (depth >= MAX_DEPTH) {
        return;
      }
      const text = await deps.noteText(path);
      if (text === null || !el.isConnected) {
        return;
      }
      const part = el.dataset.block
        ? extractBlock(text, el.dataset.block)
        : el.dataset.heading
        ? extractSection(text, el.dataset.heading)
        : text;
      if (part === null) {
        el.classList.add("unresolved");
        return;
      }
      const body = document.createElement("div");
      body.className = "note-embed-body";
      body.innerHTML = deps.renderNested(part, depth + 1);
      el.className = "note-embed note-embed-note embedded";
      el.replaceChildren(body);
      await deps.afterNested(body, depth + 1);
    }),
  );
}
