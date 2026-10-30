/**
 * Markdown to HTML for the reading view: marked (CommonMark and GitHub
 * tables, task lists, strikethrough) plus Obsidian's additions: `[[wikilinks]]`,
 * `![[embeds]]`, callouts, `#tags`, `==highlights==`, `$math$` and code blocks
 * coloured by language. The result is NOT safe yet: pass it through
 * sanitizeNoteHtml. Math is left as `<span data-math>` for hydrate.ts, so
 * KaTeX output never goes through the sanitiser's attribute rules and the
 * KaTeX chunk loads only for notes that have formulas.
 */
import { Marked, Renderer, Tokenizer } from "marked";

import { findTags, MAX_TAG_CHARS } from "../../tags/grammar";

import { altAndSize } from "./imageSize";
import { highlightCode } from "./highlight";

import type { Token, Tokens, TokenizerAndRendererExtension } from "marked";

export interface RenderContext {
  /** Obsidian's "Strict line breaks", off by default: a single newline in a paragraph is a line break. */
  strictLineBreaks?: boolean;
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

/** Enough text after `#` for the longest tag the grammar accepts. */
const TAG_LOOKAHEAD = 4 * MAX_TAG_CHARS + 2;

const tag: TokenizerAndRendererExtension = {
  name: "notetag",
  level: "inline",
  start: (src) => src.indexOf("#"),
  // The tag pane's own grammar (tags/grammar.ts, the port of search/tags.rs), so a chip is always
  // a tag the pane lists and a click finds it (toimprove 217). The character before `#` is the
  // end of the token before it.
  tokenizer(src, tokens) {
    if (src[0] !== "#") {
      return undefined;
    }
    const prev = tokens.at(-1)?.raw.slice(-1) ?? "";
    const m = findTags(prev + src.slice(0, TAG_LOOKAHEAD))[0];
    return m && m.start === prev.length
      ? { type: "notetag", raw: `#${m.display}`, tag: m.display }
      : undefined;
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
    // `$$E=mc^2$$` inside a sentence is display math, as in Obsidian (toimprove 208).
    const d = /^\$\$([^$]*?[^\s$][^$]*?)\$\$/.exec(src);
    if (d) {
      return {
        type: "inlinemath",
        raw: d[0],
        latex: d[1].trim(),
        display: true,
      };
    }
    const m = /^\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\d)/.exec(src);
    return m ? { type: "inlinemath", raw: m[0], latex: m[1] } : undefined;
  },
  renderer(token) {
    const { latex, display } = token as unknown as {
      latex: string;
      display?: boolean;
    };
    return display
      ? `<span class="note-math note-math-block" data-math="${esc(
          latex,
        )}" data-display="1">${esc(latex)}</span>`
      : `<span class="note-math" data-math="${esc(latex)}">${esc(
          latex,
        )}</span>`;
  },
};

/**
 * A block extension's `start()`: the first line start in `src` (index 0, or just after a "\n")
 * where `re` matches, else -1. It must never point into the middle of a
 * line: marked cuts the paragraph there and glues it back with an extra line, so prose showed a
 * line break the note does not have and a checkbox below ticked a later task (toimprove 202).
 */
const blockStart = (re: RegExp) => {
  const at = new RegExp(`(?:^|\\n)(?=${re.source})`);
  return (src: string): number => {
    const m = at.exec(src);
    return m ? m.index + (src[m.index] === "\n" ? 1 : 0) : -1;
  };
};
const mathStart = blockStart(/\$\$/);

const blockMath: TokenizerAndRendererExtension = {
  name: "blockmath",
  level: "block",
  start: (src) => (ctx.math ? mathStart(src) : -1),
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

/** `%%comment%%` (on one line, or a block of lines between two `%%`): hidden, as in Obsidian. */
const commentBlock: TokenizerAndRendererExtension = {
  name: "notecommentblock",
  level: "block",
  start: blockStart(/%%[ \t]*\n/),
  tokenizer(src) {
    const m = /^%%[ \t]*\n[\s\S]*?\n?%%[ \t]*(?:\n|$)/.exec(src);
    return m ? { type: "notecommentblock", raw: m[0] } : undefined;
  },
  renderer: () => "",
};

const commentInline: TokenizerAndRendererExtension = {
  name: "notecomment",
  level: "inline",
  start: (src) => src.indexOf("%%"),
  tokenizer(src) {
    const m = /^%%[\s\S]+?%%/.exec(src);
    return m ? { type: "notecomment", raw: m[0] } : undefined;
  },
  renderer: () => "",
};

/** A trailing ` ^block-id` (the target of `[[note#^id]]`): the marker is not shown. */
const blockId: TokenizerAndRendererExtension = {
  name: "noteblockid",
  level: "inline",
  start: (src) => {
    const m = /(?:^|[ \t])\^[A-Za-z0-9-]+[ \t]*(?:\n|$)/.exec(src);
    return m ? src.indexOf("^", m.index) : -1;
  },
  tokenizer(src) {
    const m = /^\^[A-Za-z0-9-]+[ \t]*(?=\n|$)/.exec(src);
    return m
      ? { type: "noteblockid", raw: m[0], id: m[0].slice(1).trim() }
      : undefined;
  },
  // An empty marker keeps the target of `[[note#^id]]` findable (noteAnchor.ts) without showing it.
  renderer: (token) =>
    `<span class="note-block-id" data-block-id="${esc(
      (token as unknown as { id: string }).id,
    )}"></span>`,
};

/** Footnotes: `[^id]` references numbered in order, and `[^id]: text` definitions listed at the end. */
interface Footnotes {
  defs: Map<string, string>;
  order: string[];
}
let notes: Footnotes = { defs: new Map(), order: [] };

const footnoteDef: TokenizerAndRendererExtension = {
  name: "footnotedef",
  level: "block",
  start: blockStart(/\[\^[^\]\s]+\]:/),
  tokenizer(src) {
    const m =
      /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?: {2,}|\t)[^\n]*)*)(?:\n|$)/.exec(
        src,
      );
    return m
      ? {
          type: "footnotedef",
          raw: m[0],
          id: m[1],
          body: m[2].replace(/\n[ \t]+/g, " ").trim(),
        }
      : undefined;
  },
  renderer(token) {
    const t = token as unknown as { id: string; body: string };
    notes.defs.set(t.id, t.body);
    return "";
  },
};

const footnoteRef: TokenizerAndRendererExtension = {
  name: "footnoteref",
  level: "inline",
  start: (src) => src.indexOf("[^"),
  tokenizer(src) {
    const m = /^\[\^([^\]\s]+)\](?!:)/.exec(src);
    return m ? { type: "footnoteref", raw: m[0], id: m[1] } : undefined;
  },
  renderer(token) {
    const id = (token as unknown as { id: string }).id;
    let n = notes.order.indexOf(id) + 1;
    if (n === 0) {
      notes.order.push(id);
      n = notes.order.length;
    }
    return `<sup class="footnote-ref"><a href="#fn-${esc(id)}" id="fnref-${esc(
      id,
    )}" data-footnote="fn-${esc(id)}">${n}</a></sup>`;
  },
};

/** The footnotes list for the references that have a definition; empty when there are none. */
const footnotesHtml = (): string => {
  const items = notes.order
    .filter((id) => notes.defs.has(id))
    .map(
      (id) =>
        `<li id="fn-${esc(id)}">${
          marked.parseInline(notes.defs.get(id)!) as string
        } <a href="#fnref-${esc(
          id,
        )}" class="footnote-back" data-footnote="fnref-${esc(
          id,
        )}">\u21a9</a></li>`,
    );
  return items.length
    ? `<section class="footnotes"><hr><ol>${items.join("")}</ol></section>\n`
    : "";
};

const CALLOUT = /^\[!([\w-]+)\]([+-]?)[ \t]*([^\n]*)(?:\n|$)/;

/**
 * Obsidian's custom task statuses: any one character between the brackets (`- [/] doing`,
 * `- [-] cancelled`, `- [>] later`) is a ticked box, as `[x]` is (toimprove 216). marked knows only
 * `[ ]` and `[x]`, so its list tokenizer runs with these two rules swapped in.
 */
const TASK_RULES = {
  listIsTask: /^\[[^\]\\\n]\] /,
  listReplaceTask: /^\[[^\]\\\n]\] +/,
};
/** The status character of a task item (`/` for `- [/] doing`), from its source. */
const TASK_MARK = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[([^\]\\\n])\]/;

const marked = new Marked({ gfm: true, breaks: false });

/**
 * Inline Markdown rendered on its own (a callout's title and first lines, a footnote) with the
 * render's own options, so line breaks follow the note's setting (toimprove 219, 229).
 */
const inline = (md: string): string =>
  marked.parseInline(md, {
    async: false,
    breaks: ctx.strictLineBreaks !== true,
  }) as string;
marked.use({
  tokenizer: {
    list(src) {
      const tok = this as unknown as {
        rules: { other: Record<string, unknown> };
      };
      const rules = tok.rules;
      tok.rules = { ...rules, other: { ...rules.other, ...TASK_RULES } };
      try {
        return Tokenizer.prototype.list.call(this, src);
      } finally {
        tok.rules = rules;
      }
    },
  },
});
marked.use({
  extensions: [
    commentBlock,
    footnoteDef,
    blockMath,
    embed,
    wikilink,
    footnoteRef,
    commentInline,
    blockId,
    tag,
    highlight,
    inlineMath,
  ],
  renderer: {
    // A custom status keeps its character, as Obsidian's `data-task` (themes style it).
    listitem(item: Tokens.ListItem) {
      const html = Renderer.prototype.listitem.call(this, item);
      const mark = item.task ? TASK_MARK.exec(item.raw)?.[1] : undefined;
      return mark && mark !== " "
        ? html.replace(
            "<li>",
            `<li class="task-list-item" data-task="${esc(mark)}">`,
          )
        : html;
    },
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
      const titleHtml = `<div class="callout-title"><span class="callout-title-text">${inline(
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
  notes = { defs: new Map(), order: [] };
  try {
    const html = marked.parse(stripFrontmatter(text), {
      async: false,
      breaks: context.strictLineBreaks !== true,
    }) as string;
    return html + footnotesHtml();
  } finally {
    notes = { defs: new Map(), order: [] };
    ctx = { resolve: () => null, highlight: true, math: true };
  }
}
