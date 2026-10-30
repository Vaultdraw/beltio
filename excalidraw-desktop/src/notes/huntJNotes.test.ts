// @vitest-environment jsdom
/**
 * Bug hunter J (2026-10-30 evening) [notes]: Obsidian vault behaviours the reading view gets wrong.
 * Obsidian is the answer key. Rows marked `it.fails` carry the toimprove number and turn red when
 * the fix lands (then drop `.fails`). Sanity rows pass today and pin what already works.
 */
import { describe, expect, it } from "vitest";

import { createResolver } from "../links/resolve";

import { resolveRelativeHref } from "./relativeLink";
import { hydrateEmbeds } from "./render/hydrate";
import { renderNoteHtml } from "./render/obsidian";
import { sanitizeNoteHtml } from "./render/sanitize";
import { extractBlock } from "./render/sections";

const html = (md: string) =>
  sanitizeNoteHtml(
    renderNoteHtml(md, { resolve: () => null, highlight: false, math: true }),
    { remoteImages: false },
  );

describe("J-1: $$display math$$ inside a sentence (toimprove 208)", () => {
  it("sanity: $$ on its own lines is display math", () => {
    expect(html("$$\nE=mc^2\n$$")).toContain('data-display="1"');
  });
  it.fails(
    "`The formula $$E=mc^2$$ is famous.` shows the formula, not the dollars",
    () => {
      const out = html("The formula $$E=mc^2$$ is famous.");
      expect(out).toContain('data-math="E=mc^2"');
      expect(out).toContain('data-display="1"');
      expect(out.replace(/data-math="[^"]*"/g, "")).not.toContain("$");
    },
  );
});

describe("J-2: an ordinary Markdown link opens the note Obsidian opens (toimprove 209)", () => {
  // Obsidian's default "New link format" is "Shortest path when possible": a link from
  // Projects/Plan.md to the only Ideas.md in the vault is written `[x](Ideas.md)`; with "Absolute
  // path in vault" it is `[x](Areas/Ideas.md)`. Both open the note in Obsidian, and the app's own
  // link resolver (links/resolve.ts, the twin of the search index) finds both.
  const paths = [
    "Projects/Plan.md",
    "Projects/Sibling.md",
    "Areas/Ideas.md",
    "Areas/Sub/Deep.md",
  ];
  const from = "Projects/Plan.md";
  it("sanity: a sibling and a ../ path resolve", () => {
    expect(resolveRelativeHref(from, "Sibling.md", paths)?.path).toBe(
      "Projects/Sibling.md",
    );
    expect(resolveRelativeHref(from, "../Areas/Ideas.md", paths)?.path).toBe(
      "Areas/Ideas.md",
    );
  });
  for (const [label, href, want] of [
    ["shortest path (unique name elsewhere)", "Ideas.md", "Areas/Ideas.md"],
    ["shortest path with a heading", "Deep.md#Top", "Areas/Sub/Deep.md"],
    ["absolute path in vault", "Areas/Ideas.md", "Areas/Ideas.md"],
    [
      "absolute path in vault, nested folder",
      "Areas/Sub/Deep.md",
      "Areas/Sub/Deep.md",
    ],
  ] as const) {
    it(`sanity: the app's link resolver finds ${label}`, () => {
      expect(createResolver(paths).resolve(from, href.split("#")[0]).path).toBe(
        want,
      );
    });
    it(`a click on [x](${href}) opens ${want} (${label})`, () => {
      expect(resolveRelativeHref(from, href, paths)?.path).toBe(want);
    });
  }
});

describe("J-3: a block id on its own line after a table, quote or list (toimprove 210)", () => {
  // Obsidian (Help > Link to blocks): "To link to a list, a table or a quote, add the block
  // identifier on its own line, after a blank line." `![[Note#^tbl]]` then embeds the table.
  const note =
    "| a | b |\n|---|---|\n| 1 | 2 |\n\n^tbl\n\n> quoted line\n\n^q\n\n- one\n- two\n\n^lst\n";
  it("sanity: an id at the end of a paragraph is found", () => {
    expect(extractBlock("Some words ^p1\n", "p1")).toBe("Some words");
  });
  for (const [id, wants] of [
    ["tbl", "| 1 | 2 |"],
    ["q", "> quoted line"],
    ["lst", "- two"],
  ] as const) {
    it.fails(`![[Note#^${id}]] embeds the block above the id line`, () => {
      expect(extractBlock(note, id)).toContain(wants);
    });
  }
});

describe("J-4: ![[pic.png|caption|300x200]] (toimprove 211)", () => {
  const hydrate = async (alias: string) => {
    const root = document.createElement("div");
    root.innerHTML = `<span data-embed="image" data-target="pic.png" data-path="pic.png" data-alias="${alias}">pic.png</span>`;
    document.body.append(root);
    await hydrateEmbeds(root, {
      imageUrl: async () => "blob:pic",
      noteText: async () => null,
      renderNested: () => "",
      afterNested: async () => {},
    } as never);
    const img = root.querySelector("img")!;
    root.remove();
    return img;
  };
  it("sanity: ![[pic.png|300]] is 300 wide", async () => {
    expect((await hydrate("300")).getAttribute("width")).toBe("300");
  });
  it.fails(
    "the size after the last | is used, as the renderer's comment promises",
    async () => {
      const img = await hydrate("My caption|300x200");
      expect(img.getAttribute("width")).toBe("300");
      expect(img.getAttribute("height")).toBe("200");
    },
  );
  it.fails(
    "the caption is the picture's alt text, not the file name",
    async () => {
      expect((await hydrate("My caption")).alt).toBe("My caption");
    },
  );
});

describe("J-2 family: what a Markdown link must NOT open (toimprove 209)", () => {
  const paths = ["Projects/Plan.md", "Areas/Ideas.md", "Areas/Ideas.excalidraw"];
  it("a ./ or ../ link opens only that file, never a namesake elsewhere", () => {
    expect(resolveRelativeHref("Projects/Plan.md", "./Ideas.md", paths)).toBeNull();
    expect(resolveRelativeHref("Projects/Plan.md", "../Ideas.md", paths)).toBeNull();
  });
  it("the extension written is kept: Ideas.md never opens the drawing", () => {
    expect(
      resolveRelativeHref("Projects/Plan.md", "Ideas.md", [
        "Projects/Plan.md",
        "Areas/Ideas.excalidraw",
      ]),
    ).toBeNull();
  });
  it("a missing note stays a dead link", () => {
    expect(resolveRelativeHref("Projects/Plan.md", "Nope.md", paths)).toBeNull();
  });
});
