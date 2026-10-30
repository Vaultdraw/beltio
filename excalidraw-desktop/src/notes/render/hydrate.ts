/**
 * Work done on the sanitised DOM after it is on the page: formulas (the
 * formula renderer, a worker running MathJax, loaded on the first formula),
 * and embeds (`![[note]]`, `![[image.png]]`) filled in from the vault. None of
 * it runs for a note without those parts.
 */
import { altAndSize } from "./imageSize";
import { extractBlock, extractSection } from "./sections";

/**
 * `from` is the note the embed sits in (undefined: the note on screen), so an embedded note's own
 * links and pictures resolve from its folder, as in Obsidian (toimprove 225).
 */
export interface EmbedDeps {
  /** Text of a vault note, or null when it cannot be read. */
  noteText: (path: string) => Promise<string | null>;
  /** A URL an <img> can show for a vault image, or null. */
  imageUrl: (path: string, from?: string) => Promise<string | null>;
  /**
   * Sanitised HTML of the nested note `from`; `depth` counts nesting. `idScope` goes in front of
   * the ids it writes, so an embed's footnotes and headings never take the host's clicks (222).
   */
  renderNested: (
    text: string,
    depth: number,
    from: string,
    idScope: string,
  ) => string;
  /** Hydrates the nested element of note `from` (formulas, pictures, deeper embeds). */
  afterNested: (el: HTMLElement, depth: number, from: string) => Promise<void>;
}

const MAX_DEPTH = 2;

/** Embedded notes rendered so far: each gets its own id scope. */
let embedRenders = 0;

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
  const [{ renderMath }, { svgToDataURL, MATH_FONT_PX }] = await Promise.all([
    import("../../plugins/mathService"),
    import("./mathImage"),
  ]);
  const color = toHex(getComputedStyle(root).color);
  await Promise.all(
    nodes.map(async (el) => {
      const source = el.dataset.math ?? "";
      const display = el.dataset.display === "1";
      const result = await renderMath({ source, display, color });
      if (!root.isConnected || !el.isConnected) {
        return;
      }
      if (!result) {
        // The formula plugin is off: the TeX source stays as text.
        el.classList.add("note-math-source");
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
      const k = fontPx / MATH_FONT_PX;
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
  from?: string,
): Promise<void> {
  const nodes = [...root.querySelectorAll<HTMLElement>("[data-embed]")];
  await Promise.all(
    nodes.map(async (el) => {
      const path = el.dataset.path;
      if (!path) {
        return;
      }
      if (el.dataset.embed === "image") {
        const url = await deps.imageUrl(path, from);
        if (!url || !el.isConnected) {
          return;
        }
        const img = document.createElement("img");
        img.className = "note-embed-img";
        // `![[pic.png|caption|300x200]]`: the shared parser, so the size after the last `|` and
        // the caption read the same here as in the import and the native side (toimprove 211).
        const { alt, width, height } = altAndSize(el.dataset.alias ?? "");
        img.alt = alt || (el.dataset.target ?? "");
        img.src = url;
        if (width !== undefined) {
          img.width = width;
        }
        if (height !== undefined) {
          img.height = height;
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
      body.innerHTML = deps.renderNested(
        part,
        depth + 1,
        path,
        `embed${++embedRenders}-`,
      );
      el.className = "note-embed note-embed-note embedded";
      el.replaceChildren(body);
      await deps.afterNested(body, depth + 1, path);
    }),
  );
}

/** Downloads one web picture and returns a blob address for it (the app's checked download). */
export type FetchRemoteImage = (url: string) => Promise<Uint8Array>;

const REMOTE_CACHE_MAX = 64;
const remoteCache = new Map<string, string>();

const imageMime = (b: Uint8Array): string => {
  const s = (i: number, t: string) =>
    [...t].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (s(1, "PNG")) {
    return "image/png";
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    return "image/jpeg";
  }
  if (s(0, "GIF8")) {
    return "image/gif";
  }
  if (s(0, "RIFF") && s(8, "WEBP")) {
    return "image/webp";
  }
  if (s(4, "ftyp")) {
    return "image/avif";
  }
  return "image/svg+xml";
};

/**
 * Loads each `img[data-remote-src]` (a web picture the sanitiser let through) with `fetch` and
 * shows it from a blob address. A picture that cannot load (offline, refused address, not a
 * picture) becomes its alt text, like a blocked one.
 */
export async function hydrateRemoteImages(
  root: HTMLElement,
  fetch: FetchRemoteImage,
): Promise<void> {
  const imgs = [
    ...root.querySelectorAll<HTMLImageElement>("img[data-remote-src]"),
  ];
  await Promise.all(
    imgs.map(async (img) => {
      const url = img.dataset.remoteSrc ?? "";
      try {
        let blob = remoteCache.get(url);
        if (!blob) {
          const bytes = await fetch(url);
          blob = URL.createObjectURL(
            new Blob([bytes as BlobPart], { type: imageMime(bytes) }),
          );
          remoteCache.set(url, blob);
          if (remoteCache.size > REMOTE_CACHE_MAX) {
            const [oldest] = remoteCache.keys();
            URL.revokeObjectURL(remoteCache.get(oldest)!);
            remoteCache.delete(oldest);
          }
        }
        if (img.isConnected) {
          img.src = blob;
          img.removeAttribute("data-remote-src");
        }
      } catch {
        if (!img.isConnected) {
          return;
        }
        const stub = img.ownerDocument.createElement("span");
        stub.className = "note-image-blocked";
        stub.textContent = img.alt || "Image from the web (could not load)";
        stub.title = url;
        img.replaceWith(stub);
      }
    }),
  );
}
