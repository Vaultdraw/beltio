// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { highlightCode } from "./render/highlight";
import {
  renderNoteHtml,
  splitWikilink,
  stripFrontmatter,
} from "./render/obsidian";
import { extractBlock, extractSection } from "./render/sections";
import { sanitizeNoteHtml } from "./render/sanitize";

const ctx = (known: Record<string, string> = {}) => ({
  resolve: (t: string) => known[t] ?? null,
  highlight: true,
  math: true,
});
const html = (md: string, known?: Record<string, string>, remote = false) =>
  sanitizeNoteHtml(renderNoteHtml(md, ctx(known)), { remoteImages: remote });

describe("wikilinks", () => {
  it("splits target, heading, block and alias", () => {
    expect(splitWikilink("Note#Head|Alias")).toEqual({
      target: "Note",
      heading: "Head",
      blockRef: undefined,
      alias: "Alias",
    });
    expect(splitWikilink("Note#^abc")).toMatchObject({
      target: "Note",
      blockRef: "abc",
    });
    expect(splitWikilink("#Only")).toMatchObject({
      target: "",
      heading: "Only",
    });
  });

  it("renders resolved and unresolved links", () => {
    const out = html("See [[Other]] and [[Nope|nothing]].", {
      Other: "f/Other.md",
    });
    expect(out).toContain('class="wikilink"');
    expect(out).toContain('data-path="f/Other.md"');
    expect(out).toContain('class="wikilink unresolved"');
    expect(out).toContain(">nothing</a>");
  });

  it("does not link inside code", () => {
    const out = html("`[[x]]` and\n\n```\n[[y]]\n```");
    expect(out).not.toContain("wikilink");
  });
});

describe("callouts", () => {
  it("renders a callout with a title and a body", () => {
    const out = html("> [!warning] Careful\n> Mind the *gap*.\n>\n> More.");
    expect(out).toContain('data-callout="warning"');
    expect(out).toContain("Careful");
    expect(out).toContain("<em>gap</em>");
    expect(out).toContain("More.");
  });

  it("uses the type as the title and folds with +/-", () => {
    const out = html("> [!note]-\n> hidden");
    expect(out).toContain("<details");
    expect(out).not.toContain(" open");
    expect(out).toContain("Note");
    expect(html("> [!tip]+ T\n> shown")).toContain(" open");
  });

  it("leaves a plain quote alone", () => {
    expect(html("> just a quote")).toContain("<blockquote>");
  });
});

describe("other Obsidian syntax", () => {
  it("embeds, tags, highlights, math placeholders", () => {
    const out = html("![[Pic.png|300]] #idea ==marked== $x^2$\n\n$$\ny\n$$", {
      "Pic.png": "Pic.png",
    });
    expect(out).toContain('data-embed="image"');
    expect(out).toContain('data-alias="300"');
    expect(out).toContain('class="note-tag"');
    expect(out).toContain("<mark>marked</mark>");
    expect(out).toContain('data-math="x^2"');
    expect(out).toContain('data-display="1"');
  });

  it("image embeds show in callouts, lists, tables and quotes, with their width", () => {
    const out = html(
      [
        "> [!note] T",
        "> ![[a.png|120]]",
        "",
        "- item ![[b.gif]]",
        "",
        "1. ![[c.webp|50x20]]",
        "",
        "| x | y |",
        "|---|---|",
        "| ![[d.svg\\|40]] | ![[Ünï/e e.png]] |",
      ].join("\n"),
    );
    const targets = [
      ...out.matchAll(/data-embed="image" data-target="([^"]+)"/g),
    ].map((m) => m[1]);
    expect(targets).toEqual([
      "a.png",
      "b.gif",
      "c.webp",
      "d.svg",
      "Ünï/e e.png",
    ]);
    expect(out).toContain('data-alias="40"');
  });

  it("math off leaves dollars alone", () => {
    const out = sanitizeNoteHtml(
      renderNoteHtml("costs $5 and $6", { ...ctx(), math: false }),
      { remoteImages: false },
    );
    expect(out).toContain("$5 and $6");
    expect(out).not.toContain("data-math");
  });

  it("keeps bold and italic, tables and task lists", () => {
    const out = html(
      "**b** *i*\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done",
    );
    expect(out).toContain("<strong>b</strong>");
    expect(out).toContain("<table>");
    expect(out).toContain('type="checkbox"');
  });

  it("strips front matter and gives headings ids", () => {
    expect(stripFrontmatter("---\na: 1\n---\n# T")).toBe("# T");
    expect(html("---\na: 1\n---\n# Hello World")).toContain('id="hello-world"');
  });
});

describe("sanitising", () => {
  it("removes scripts, handlers, styles and javascript links", () => {
    const out = html(
      '<script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a><div style="position:fixed">y</div><iframe src="//e"></iframe>',
    );
    expect(out).not.toMatch(/script|onerror|javascript:|style=|iframe/i);
  });

  it("keeps remote images out unless allowed", () => {
    const md = "![alt text](https://example.com/a.png)";
    expect(html(md)).not.toContain("<img");
    expect(html(md)).toContain("alt text");
    expect(html(md, {}, true)).toContain('src="https://example.com/a.png"');
  });

  it("marks external links", () => {
    expect(html("[x](https://example.com)")).toContain('data-external="1"');
  });
});

describe("code highlighting", () => {
  it("colours strings, keywords, numbers and comments", () => {
    const out = highlightCode('const a = "x"; // hi\nlet n = 42', "ts");
    expect(out).toContain('<span class="tok-keyword">const</span>');
    expect(out).toContain(
      '<span class="tok-string">&quot;x&quot;</span>'
        .replace("&quot;", '"')
        .replace("&quot;", '"'),
    );
    expect(out).toContain('<span class="tok-comment">// hi</span>');
    expect(out).toContain('<span class="tok-number">42</span>');
  });

  it("escapes and leaves unknown languages plain", () => {
    expect(highlightCode("<b>&</b>", "weird")).toBe("&lt;b&gt;&amp;&lt;/b&gt;");
    expect(highlightCode("a < b", "ts")).toContain("&lt;");
  });

  it("is used for fenced code and can be turned off", () => {
    expect(html("```js\nconst a = 1\n```")).toContain("tok-keyword");
    const off = sanitizeNoteHtml(
      renderNoteHtml("```js\nconst a = 1\n```", { ...ctx(), highlight: false }),
      { remoteImages: false },
    );
    expect(off).not.toContain("tok-");
  });
});

describe("embed pieces", () => {
  const note =
    "# A\nintro\n## B\nbody b\n```\n# not a heading\n```\n### C\nc\n## D\nd\n\nA para ^p1\n- item ^i1";
  it("takes a section up to the next heading of the same level", () => {
    expect(extractSection(note, "B")).toBe(
      "## B\nbody b\n```\n# not a heading\n```\n### C\nc",
    );
    expect(extractSection(note, "nope")).toBeNull();
  });

  it("takes a block by its id", () => {
    expect(extractBlock(note, "p1")).toBe("A para");
    expect(extractBlock(note, "i1")).toBe("- item");
    expect(extractBlock(note, "zz")).toBeNull();
  });
});
