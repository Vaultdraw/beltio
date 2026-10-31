// @vitest-environment jsdom
/**
 * Family "twin parsers": a heading is found by three copies of the same idea, the renderer's id
 * (`slug` in render/obsidian.ts), the anchor finder (`noteAnchor.ts`, a `[[Note#Heading]]` link
 * scrolling the reading view) and the section reader (`render/sections.ts`, `![[Note#Heading]]`
 * embeds). For one heading source, the text the user sees in the reading view must find that
 * heading in BOTH other copies. Each row is a heading as typed. Toimprove 311, fixed: sections come from the renderer's tokens.
 */
import { describe, expect, it } from "vitest";

import { findAnchorElement } from "./noteAnchor";
import { renderNoteHtml } from "./render/obsidian";
import { extractSection } from "./render/sections";
import { sanitizeNoteHtml } from "./render/sanitize";

type Row = {
  name: string;
  heading: string;
};

const rows: Row[] = [
  { name: "plain words", heading: "Plan for May" },
  { name: "bold and italic", heading: "A **bold** and *it* word" },
  { name: "inline code", heading: "Use `git rebase` here" },
  { name: "highlight", heading: "A ==marked== word" },
  { name: "strike", heading: "A ~~gone~~ word" },
  { name: "wikilink", heading: "See [[Other]] now" },
  {
    name: "markdown link",
    heading: "Read [the docs](https://x.y) now",
  },
  { name: "tag", heading: "Tagged #idea here" },
  { name: "ampersand", heading: "Q&A" },
  { name: "punctuation", heading: "What's new? C++ 17: now" },
  { name: "accents composed", heading: "Café menu" },
  { name: "accents decomposed", heading: "Café menu" },
  { name: "emoji", heading: "Launch \u{1F680} day" },
  { name: "numbered title", heading: "1. Intro" },
  { name: "slash", heading: "A/B test" },
  { name: "underscore word", heading: "snake_case name" },
  { name: "trailing hashes", heading: "Closed heading ##" },
];

const noteOf = (heading: string) =>
  `Intro line\n\n## ${heading}\n\nbody of it\n\n### child\n\nchild body\n\n## Next\n\nnext body\n`;

const render = (md: string): HTMLElement => {
  const div = document.createElement("div");
  div.innerHTML = sanitizeNoteHtml(
    renderNoteHtml(md, {
      resolve: (t) => (t === "Other" ? "Other.md" : null),
      highlight: false,
      math: true,
    }),
    { remoteImages: false },
  );
  return div;
};

describe("a heading seen in the reading view is found by the anchor finder and the section reader", () => {
  for (const row of rows) {
    const md = noteOf(row.heading);
    const root = render(md);
    const h = root.querySelector("h2");
    const shown = (h?.textContent ?? "").trim();
    it(`${row.name}: [[Note#${row.heading}]] style link by the text shown`, () => {
      expect(shown.length).toBeGreaterThan(0);
      expect(findAnchorElement(root, { heading: shown })).toBe(h);
    });
    it(`${row.name}: ![[Note#...]] embed of the text shown`, () => {
      const out = extractSection(md, shown);
      expect(out, `shown as "${shown}"`).not.toBeNull();
      expect(out).toContain("body of it");
      expect(out).toContain("child body");
      expect(out).not.toContain("next body");
    });
  }
});

// The section reader scans lines; the renderer parses. Text that is NOT a heading in the reading
// view must not end a section, and a heading the reading view draws must start one.
const body = "body of it";
const REAL_NEXT = "## Next\n\nnext body\n";
const fakeInside: Record<string, { md: string }> = {
  "a four-backtick fence holding a three-backtick line": {
    md: `## Sec\n\n${body}\n\n\`\`\`\`md\n\`\`\`\n# fake\n\`\`\`\n\`\`\`\`\n\nafter fence\n\n${REAL_NEXT}`,
  },
  "a $$ math block holding a hash line": {
    md: `## Sec\n\n${body}\n\n$$\n# fake\n$$\n\nafter math\n\n${REAL_NEXT}`,
  },
  "a %% comment holding a hash line": {
    md: `## Sec\n\n${body}\n\n%%\n# fake\n%%\n\nafter comment\n\n${REAL_NEXT}`,
  },
  "an html comment holding a hash line": {
    md: `## Sec\n\n${body}\n\n<!--\n# fake\n-->\n\nafter html\n\n${REAL_NEXT}`,
  },
  "indented code holding a hash line": {
    md: `## Sec\n\n${body}\n\n    # fake\n\nafter code\n\n${REAL_NEXT}`,
  },
  "a fence inside a list item (indented 4)": {
    md: `## Sec\n\n- item\n\n    \`\`\`\n    # fake\n    \`\`\`\n\nafter list\n\n${body}\n\n${REAL_NEXT}`,
  },
};

describe("the section reader does not end a section at text the reading view does not draw as a heading", () => {
  for (const [name, { md }] of Object.entries(fakeInside)) {
    it(name, () => {
      const headings = [
        ...render(md).querySelectorAll("h1,h2,h3,h4,h5,h6"),
      ].map((h) => h.textContent);
      expect(
        headings,
        "the reading view draws only the two real headings",
      ).toEqual(["Sec", "Next"]);
      const out = extractSection(md, "Sec");
      expect(out).toContain("after");
      expect(out).not.toContain("next body");
    });
  }
});

describe("the section reader starts a section at every heading the reading view draws", () => {
  const drawn: Record<string, { md: string; name: string }> = {
    indent3: {
      md: `   ## Sec\n\n${body}\n\n${REAL_NEXT}`,
      name: "Sec",
    },
    setext: {
      md: `Sec\n---\n\n${body}\n\n${REAL_NEXT}`,
      name: "Sec",
    },
    setext1: {
      // A level-1 section holds its `##` children (Obsidian too), so the next heading is a `#`.
      md: `Sec\n===\n\n${body}\n\n# Next\n\nnext body\n`,
      name: "Sec",
    },
    tab: { md: `##\tSec\n\n${body}\n\n${REAL_NEXT}`, name: "Sec" },
    crlf: {
      md: `## Sec\r\n\r\n${body}\r\n\r\n${REAL_NEXT}`.replace(
        /\n(?!\r)/g,
        "\r\n",
      ),
      name: "Sec",
    },
    frontMatter: {
      md: `---\na: 1\n---\n## Sec\n\n${body}\n\n${REAL_NEXT}`,
      name: "Sec",
    },
    closing: { md: `## Sec ##\n\n${body}\n\n${REAL_NEXT}`, name: "Sec" },
  };
  for (const [name, { md, name: want }] of Object.entries(drawn)) {
    it(name, () => {
      const hs = [...render(md).querySelectorAll("h1,h2,h3,h4,h5,h6")];
      expect(hs.map((h) => (h.textContent ?? "").trim())).toContain(want);
      const out = extractSection(md, want);
      expect(out).not.toBeNull();
      expect(out).toContain(body);
      expect(out).not.toContain("next body");
    });
  }
});
