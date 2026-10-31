// @vitest-environment jsdom
/**
 * Family "lexer and render cost is linear in note size" (toimprove 288, 294): every Markdown
 * construct the reading view knows, written as many blocks (blank-line separated) and as one block
 * (no blank line), at 1x and 4x the size (400 and 1,600 units). The check is a growth ratio, not a clock:
 * 4 times the text must cost under 8 times the time (linear is 4, quadratic is 16).
 */
import { describe, expect, it } from "vitest";

import { renderNoteHtml } from "./obsidian";

const CONSTRUCTS: Record<string, (i: number) => string> = {
  paragraph: (i) => `Plain paragraph ${i} lorem ipsum dolor sit amet.`,
  heading: (i) => `## Heading ${i}`,
  setext: (i) => `Setext ${i}\n---`,
  bullet: (i) => `- item ${i}`,
  numbered: (i) => `${i + 1}. item ${i}`,
  task: (i) => `- [${i % 2 ? "x" : " "}] task ${i}`,
  nestedList: (i) => `- a ${i}\n  - b\n    - c`,
  quote: (i) => `> quote ${i}`,
  callout: (i) => `> [!note] Title ${i}\n> body ${i}`,
  foldedCallout: (i) => `> [!tip]- Title ${i}\n> body ${i}`,
  code: (i) => `\`\`\`js\nconst a${i} = 1;\n\`\`\``,
  indentedCode: (i) => `    code ${i}`,
  table: (i) => `| a | b |\n|---|---|\n| ${i} | x |`,
  wikilink: (i) =>
    `see [[Note ${i}]] and [[Note ${i}|alias]] and [[Note#Head]]`,
  embed: (i) => `![[Note ${i}]] ![[pic${i}.png|100]]`,
  tag: (i) => `#tag${i} #nested/tag${i}`,
  highlight: (i) =>
    `==mark ${i}== and **bold** and *it* and ~~del~~ and \`code\``,
  mathInline: (i) => `inline $a_${i}$ math`,
  mathBlock: (i) => `$$\nx_${i}=1\n$$`,
  comment: (i) => `a %%hidden ${i}%% b`,
  commentBlock: (i) => `%%\nhidden ${i}\n%%`,
  footnote: (i) => `Claim[^${i}]\n\n[^${i}]: Note ${i}.`,
  blockId: (i) => `Paragraph ${i} ^id${i}`,
  link: (i) => `[text ${i}](https://example.com/${i}) <https://a.b/${i}>`,
  html: (i) => `<div>raw ${i}</div>`,
  rule: () => `***`,
  hardBreak: (i) => `line ${i}  \nnext`,
  image: (i) => `![alt ${i}|50](pic${i}.png)`,
  // Unclosed openers: the classic quadratic case (each one scans to the end for its closer).
  unclosedWikilink: (i) => `open [[Note ${i} never closed`,
  unclosedEmbed: (i) => `open ![[Note ${i} never closed`,
  unclosedMath: (i) => `cost $${i} then more`,
  unclosedHighlight: (i) => `a ==open ${i}`,
  unclosedComment: (i) => `a %%open ${i}`,
  unclosedBold: (i) => `a **open ${i}`,
  unclosedStar: (i) => `a *open ${i}`,
  unclosedItalic: (i) => `a _open ${i} and *star`,
  unclosedCode: (i) => `a \`open ${i}`,
  unclosedLink: (i) => `a [open ${i} and (paren`,
  unclosedFootnote: (i) => `a [^open${i}`,
  unclosedHtml: (i) => `a <open ${i} and 1 < 2`,
  unclosedFence: (i) => `\`\`\`js\nline ${i}`,
  manyRefsOneDef: (i) => `ref[^same] ${i}`,
  quoteDepth: (i) => `${">".repeat((i % 6) + 1)} deep ${i}`,
  listDepth: (i) => `${"  ".repeat(i % 6)}- deep ${i}`,
};

const render = (md: string) => {
  const t = performance.now();
  renderNoteHtml(md, { resolve: () => null, highlight: false, math: true });
  return performance.now() - t;
};
const build = (f: (i: number) => string, n: number, sep: string) =>
  Array.from({ length: n }, (_, i) => f(i)).join(sep);
const best = (md: string) => Math.min(render(md), render(md));

const BASE = 400;
const LAYOUTS: Record<string, string> = { blocks: "\n\n", oneBlock: "\n" };
// Members that are still quadratic: none. marked's own emphasis pass was (toimprove 297, fixed by
// EMPHASIS_REACH in obsidian.ts); a new one goes here as `it.fails` until fixed.
const QUADRATIC = new Set<string>([]);

describe("render time grows linearly for every Markdown construct", () => {
  for (const [layout, sep] of Object.entries(LAYOUTS)) {
    for (const [name, f] of Object.entries(CONSTRUCTS)) {
      const run = QUADRATIC.has(`${layout} ${name}`) ? it.fails : it;
      run(
        `${name} (${layout}): 4x the text under 8x the time`,
        () => {
          render(build(f, 40, sep));
          const a = best(build(f, BASE, sep));
          const b = best(build(f, BASE * 4, sep));
          expect(b / Math.max(a, 3)).toBeLessThan(8);
        },
        120_000,
      );
    }
  }
});
