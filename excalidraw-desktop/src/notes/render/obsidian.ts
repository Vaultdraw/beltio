/**
 * Markdown to HTML for the reading view: marked (CommonMark and GitHub
 * tables, task lists, strikethrough) plus Obsidian's additions: `[[wikilinks]]`,
 * `![[embeds]]`, callouts, `#tags`, `==highlights==`, `$math$` and code blocks
 * coloured by language. The result is NOT safe yet: pass it through
 * sanitizeNoteHtml. Math is left as `<span data-math>` for hydrate.ts, so
 * KaTeX output never goes through the sanitiser's attribute rules and the
 * KaTeX chunk loads only for notes that have formulas.
 */
import { Marked } from "marked";

import { altAndSize } from "./imageSize";
import { highlightCode } from "./highlight";

import type { Token, Tokens, TokenizerAndRendererExtension } from "marked";

export interface RenderContext {
  /** Vault path a `[[target]]` points to, or null when it does not exist. */
  resolve: (target: string) => string | null;
  highlight: boolean;
  math: boolean;
}

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The render in progress; marked's renderers run synchronously. */
let ctx: RenderContext = { resolve: () => null, highlight: true, math: true };

const IMAGE = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");

/** `target#heading^block` and `|alias` of the inside of `[[…]]` / `![[…]]`. */
export function splitWikilink(inner: string): {
  target: string;
  heading?: string;
  blockRef?: string;
  alias?: string;
} {
  const bar = inner.indexOf("|");
  const alias = bar >= 0 ? inner.slice(bar + 1).trim() : undefined;
  let ref = bar >= 0 ? inner.slice(0, bar) : inner;
  let blockRef: string | undefined;
  const caret = ref.indexOf("#^");
  if (caret >= 0) {
    blockRef = ref.slice(caret + 2).trim();
    ref = ref.slice(0, caret);
  }
  let heading: string | undefined;
  const hash = ref.indexOf("#");
  if (hash >= 0) {
    heading = ref.slice(hash + 1).trim();
    ref = ref.slice(0, hash);
  }
  return { target: ref.trim(), heading, blockRef, alias };
}

const wikilink: TokenizerAndRendererExtension = {
  name: "wikilink",
  level: "inline",
  start: (src) => src.indexOf("[["),
  tokenizer(src) {
    const m = /^\[\[([^\]\n]+)\]\]/.exec(src);
    return m ? { type: "wikilink", raw: m[0], inner: m[1] } : undefined;
  },
  renderer(token) {
    const { target, heading, blockRef, alias } = splitWikilink(
      (token as unknown as { inner: string }).inner,
    );
    const path = target ? ctx.resolve(target) : "";
    const label =
      alias ||
      (heading
        ? target
          ? `${target} > ${heading}`
          : heading
        : blockRef
        ? target
          ? `${target} > ^${blockRef}`
          : `^${blockRef}`
        : target);
    const data = `data-target="${esc(target)}"${
      heading ? ` data-heading="${esc(heading)}"` : ""
    }${blockRef ? ` data-block="${esc(blockRef)}"` : ""}${
      path ? ` data-path="${esc(path)}"` : ""
    }`;
    return `<a class="wikilink${
      path === null ? " unresolved" : ""
    }" href="#" ${data}>${esc(label)}</a>`;
  },
};

const embed: TokenizerAndRendererExtension = {
  name: "wikiembed",
  level: "inline",
  start: (src) => src.indexOf("![["),
  tokenizer(src) {
    const m = /^!\[\[([^\]\n]+)\]\]/.exec(src);
    return m ? { type: "wikiembed", raw: m[0], inner: m[1] } : undefined;
  },
  renderer(token) {
    const { target, heading, blockRef, alias } = splitWikilink(
      (token as unknown as { inner: string }).inner,
    );
    // `![[pic.png|300]]` / `![[pic.png|alt|300x200]]`
    const kind = IMAGE.test(target) ? "image" : "note";
    // Images are found by the backend (next to the note, by name); notes by the link index.
    const path = kind === "image" ? target : ctx.resolve(target);
    const attrs = `data-embed="${kind}" data-target="${esc(target)}"${
      path ? ` data-path="${esc(path)}"` : ""
    }${heading ? ` data-heading="${esc(heading)}"` : ""}${
      blockRef ? ` data-block="${esc(blockRef)}"` : ""
    }${alias ? ` data-alias="${esc(alias)}"` : ""}`;
    return `<span class="note-embed note-embed-${kind}${
      path ? "" : " unresolved"
    }" ${attrs}>${esc(alias && kind === "note" ? alias : target)}</span>`;
  },
};

const tag: TokenizerAndRendererExtension = {
  name: "notetag",
  level: "inline",
  start: (src) => {
    const m = /(?:^|[\s(])#[\p{L}\p{N}_/-]/u.exec(src);
    return m ? src.indexOf("#", m.index) : -1;
  },
  tokenizer(src) {
    const m = /^#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/u.exec(src);
    return m ? { type: "notetag", raw: m[0], tag: m[1] } : undefined;
  },
  renderer(token) {
    const name = (token as unknown as { tag: string }).tag;
    return `<span class="note-tag" data-tag="${esc(name)}">#${esc(
      name,
    )}</span>`;
  },
};

const highlight: TokenizerAndRendererExtension = {
  name: "notemark",
  level: "inline",
  start: (src) => src.indexOf("=="),
  tokenizer(src) {
    const m = /^==(?=\S)([^\n]*?\S)==/.exec(src);
    return m
      ? {
          type: "notemark",
          raw: m[0],
          text: m[1],
          tokens: this.lexer.inlineTokens(m[1]),
        }
      : undefined;
  },
  renderer(token) {
    return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`;
  },
};

const inlineMath: TokenizerAndRendererExtension = {
  name: "inlinemath",
  level: "inline",
  start: (src) => (ctx.math ? src.indexOf("$") : -1),
  tokenizer(src) {
    if (!ctx.math) {
      return undefined;
    }
    const m = /^\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\d)/.exec(src);
    return m ? { type: "inlinemath", raw: m[0], latex: m[1] } : undefined;
  },
  renderer(token) {
    const latex = (token as unknown as { latex: string }).latex;
    return `<span class="note-math" data-math="${esc(latex)}">${esc(
      latex,
    )}</span>`;
  },
};

const blockMath: TokenizerAndRendererExtension = {
  name: "blockmath",
  level: "block",
  start: (src) => (ctx.math ? src.indexOf("$$") : -1),
  tokenizer(src) {
    if (!ctx.math) {
      return undefined;
    }
    const m = /^\$\$\n?([\s\S]+?)\n?\$\$[ \t]*(?:\n|$)/.exec(src);
    return m ? { type: "blockmath", raw: m[0], latex: m[1].trim() } : undefined;
  },
  renderer(token) {
    const latex = (token as unknown as { latex: string }).latex;
    return `<div class="note-math note-math-block" data-math="${esc(
      latex,
    )}" data-display="1">${esc(latex)}</div>\n`;
  },
};

const CALLOUT = /^\[!([\w-]+)\]([+-]?)[ \t]*([^\n]*)(?:\n|$)/;

const marked = new Marked({ gfm: true, breaks: false });
marked.use({
  extensions: [blockMath, embed, wikilink, tag, highlight, inlineMath],
  renderer: {
    heading({ tokens, depth, text }: Tokens.Heading) {
      return `<h${depth} id="${esc(slug(text))}">${this.parser.parseInline(
        tokens,
      )}</h${depth}>\n`;
    },
    // `![alt|100](pic.png)` and `![alt|100x50](pic.png)`: the size is not part of the alt text.
    image({ href, title, text }: Tokens.Image) {
      const { alt, width, height } = altAndSize(text);
      return `<img src="${esc(href)}" alt="${esc(alt)}"${
        title ? ` title="${esc(title)}"` : ""
      }${width ? ` width="${width}"` : ""}${
        height ? ` height="${height}"` : ""
      }>`;
    },
    code({ text, lang }: Tokens.Code) {
      const language = (lang ?? "").trim().split(/\s+/)[0];
      const body = ctx.highlight ? highlightCode(text, language) : esc(text);
      return `<pre><code${
        language ? ` class="language-${esc(language)}"` : ""
      }>${body}</code></pre>\n`;
    },
    blockquote({ tokens }: Tokens.Blockquote) {
      const first = tokens[0];
      const head =
        first && first.type === "paragraph"
          ? CALLOUT.exec((first as Tokens.Paragraph).text)
          : null;
      if (!head) {
        return `<blockquote>\n${this.parser.parse(tokens)}</blockquote>\n`;
      }
      const type = head[1].toLowerCase();
      const fold = head[2];
      const title =
        head[3].trim() ||
        head[1][0].toUpperCase() + head[1].slice(1).toLowerCase();
      const rest = (first as Tokens.Paragraph).text.slice(head[0].length);
      const body =
        (rest.trim()
          ? `<p>${marked.parseInline(rest.trim()) as string}</p>`
          : "") + this.parser.parse(tokens.slice(1));
      const titleHtml = `<div class="callout-title"><span class="callout-title-text">${esc(
        title,
      )}</span></div>`;
      if (fold) {
        return `<details class="callout" data-callout="${esc(type)}"${
          fold === "+" ? " open" : ""
        }><summary>${titleHtml}</summary><div class="callout-body">${body}</div></details>\n`;
      }
      return `<div class="callout" data-callout="${esc(
        type,
      )}">${titleHtml}<div class="callout-body">${body}</div></div>\n`;
    },
  },
});

const FRONTMATTER =
  /^﻿?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** The note without its leading `---` properties block. */
export const stripFrontmatter = (text: string): string =>
  text.replace(FRONTMATTER, "");

/**
 * The block tokens the reading view renders for `text` (front matter stripped), and how many lines
 * the stripped front matter took. For code that must agree with what the renderer drew, such as
 * which line a checkbox belongs to.
 */
export function lexNote(
  text: string,
  math = true,
): { tokens: Token[]; skipped: number } {
  const body = stripFrontmatter(text);
  const removed = text.slice(0, text.length - body.length);
  ctx = { resolve: () => null, highlight: false, math };
  try {
    return {
      tokens: marked.lexer(body),
      skipped: (removed.match(/\n/g) ?? []).length,
    };
  } finally {
    ctx = { resolve: () => null, highlight: true, math: true };
  }
}

/** Unsafe HTML for `text`; always sanitise before use. */
export function renderNoteHtml(text: string, context: RenderContext): string {
  ctx = context;
  try {
    return marked.parse(stripFrontmatter(text), { async: false }) as string;
  } finally {
    ctx = { resolve: () => null, highlight: true, math: true };
  }
}
