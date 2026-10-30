// @vitest-environment jsdom
/**
 * Bug hunter J (2026-10-30 evening) [notes]: Obsidian vault behaviours the reading view gets wrong.
 * Obsidian is the answer key. Rows marked `it.fails` carry the toimprove number and turn red when
 * the fix lands (then drop `.fails`). Sanity rows pass today and pin what already works.
 */
import { describe, expect, it } from "vitest";

import { createResolver } from "../links/resolve";
import { findTags } from "../tags/grammar";

import { findAnchorElement } from "./noteAnchor";
import { taskLines, toggleTask } from "./noteTasks";
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
  it("`The formula $$E=mc^2$$ is famous.` shows the formula, not the dollars", () => {
    const out = html("The formula $$E=mc^2$$ is famous.");
    expect(out).toContain('data-math="E=mc^2"');
    expect(out).toContain('data-display="1"');
    expect(out.replace(/data-math="[^"]*"/g, "")).not.toContain("$");
  });
});

describe("J-1 family: dollars that are not display math (toimprove 208)", () => {
  it("prices with one $ stay text", () => {
    expect(html("It was $5 and then $6.")).not.toContain("data-math");
  });
  it("an empty $$$$ stays text", () => {
    expect(html("Nothing $$ $$ here.")).not.toContain("data-math");
  });
  it("inline $math$ is not display math", () => {
    expect(html("Area $x^2$ grows.")).not.toContain("data-display");
  });
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
    it(`![[Note#^${id}]] embeds the block above the id line`, () => {
      expect(extractBlock(note, id)).toContain(wants);
    });
  }
});

describe("J-3 family: [[Note#^id]] scrolls to the block an own-line id names (toimprove 210)", () => {
  it("the table above the id line is the target, not the empty line", () => {
    const root = document.createElement("div");
    root.innerHTML = sanitizeNoteHtml(
      renderNoteHtml("| a |\n|---|\n| 1 |\n\n^tbl\n\nAfter ^p2\n", {
        resolve: () => null,
        highlight: false,
        math: false,
      }),
      { remoteImages: false },
    );
    expect(findAnchorElement(root, { block: "tbl" })?.tagName).toBe("TABLE");
    expect(findAnchorElement(root, { block: "p2" })?.tagName).toBe("P");
  });
  it("an id after a blank line at the very top names nothing", () => {
    expect(extractBlock("^top\n\ntext", "top")).toBeNull();
  });
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
  it("the size after the last | is used, as the renderer's comment promises", async () => {
    const img = await hydrate("My caption|300x200");
    expect(img.getAttribute("width")).toBe("300");
    expect(img.getAttribute("height")).toBe("200");
  });
  it("the caption is the picture's alt text, not the file name", async () => {
    expect((await hydrate("My caption")).alt).toBe("My caption");
  });
});

describe("J-2 family: what a Markdown link must NOT open (toimprove 209)", () => {
  const paths = [
    "Projects/Plan.md",
    "Areas/Ideas.md",
    "Areas/Ideas.excalidraw",
  ];
  it("a ./ or ../ link opens only that file, never a namesake elsewhere", () => {
    expect(
      resolveRelativeHref("Projects/Plan.md", "./Ideas.md", paths),
    ).toBeNull();
    expect(
      resolveRelativeHref("Projects/Plan.md", "../Ideas.md", paths),
    ).toBeNull();
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
    expect(
      resolveRelativeHref("Projects/Plan.md", "Nope.md", paths),
    ).toBeNull();
  });
});

describe("J-7: Obsidian's custom task statuses (toimprove 216)", () => {
  const boxes = (md: string) => {
    const div = document.createElement("div");
    div.innerHTML = html(md);
    return [
      ...div.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
  };
  it("sanity: [ ] and [x] are boxes", () => {
    expect(boxes("- [ ] a\n- [x] b")).toHaveLength(2);
  });
  for (const mark of ["/", "-", ">", "?"]) {
    it(`- [${mark}] is a ticked box, not the text "[${mark}]"`, () => {
      const md = `- [${mark}] item`;
      expect(boxes(md)).toHaveLength(1);
      expect(html(md)).not.toContain(`[${mark === ">" ? "&gt;" : mark}]`);
    });
  }
});

describe("J-7 family: custom statuses in the task map (toimprove 216)", () => {
  it("a custom status keeps its character for themes", () => {
    expect(html("- [/] doing")).toContain('data-task="/"');
    expect(html("- [ ] open")).not.toContain("data-task");
  });
  it("ticking a [/] box clears it, and the boxes below stay matched", () => {
    const md = "- [/] doing\n- [ ] next";
    expect(taskLines(md)).toEqual([0, 1]);
    expect(toggleTask(md, 0)).toBe("- [ ] doing\n- [ ] next");
    expect(toggleTask(md, 1)).toBe("- [/] doing\n- [x] next");
  });
  it("[[links]] and [^notes] at the start of an item are not tasks", () => {
    expect(taskLines("- [[Note]] x\n- [^1] y")).toEqual([]);
  });
});

describe("J-8: tag chips in a note follow the tag grammar the tag pane uses (toimprove 217)", () => {
  const chips = (md: string) => {
    const div = document.createElement("div");
    div.innerHTML = html(md);
    return [
      ...div.querySelectorAll<HTMLElement>(".note-body .note-tag, .note-tag"),
    ].map((e) => e.dataset.tag);
  };
  const AGREE = [
    "#café today",
    "[#br]",
    "#_under",
    "#2024",
    "#tag's",
    "#Ünï",
    "C# and issue#12 are not tags",
    "two #a #b",
  ];
  const DRIFT = [
    "colour #ff00aa here",
    "bg #1e1e1e",
    "#a1b",
    "ends #tag-",
    "path #a/b/",
    "x #a//b",
    'quote "#q"',
    "list,#c",
    "x:#k",
  ];
  for (const text of AGREE) {
    it(`sanity: ${text}`, () => {
      expect(chips(text)).toEqual(findTags(text).map((m) => m.display));
    });
  }
  for (const text of DRIFT) {
    it(`${text}: the chips are the tags the pane lists`, () => {
      expect(chips(text)).toEqual(findTags(text).map((m) => m.display));
    });
  }
});

describe("J-9: ![[Sketch]] embeds a drawing (toimprove 218)", () => {
  it.fails(
    "a drawing embed shows the drawing or at least a link to it",
    async () => {
      const root = document.createElement("div");
      root.innerHTML = sanitizeNoteHtml(
        renderNoteHtml("See ![[Sketch]] here.", {
          resolve: (t) => (t === "Sketch" ? "Sketch.excalidraw" : null),
          highlight: false,
          math: true,
        }),
        { remoteImages: false },
      );
      document.body.append(root);
      await hydrateEmbeds(root, {
        imageUrl: async () => null,
        // The native read refuses anything that is not a .md note (note_file.rs check_note_path).
        noteText: async (p: string) => (p.endsWith(".md") ? "" : null),
        renderNested: () => "",
        afterNested: async () => {},
      } as never);
      const embed = root.querySelector('[data-path="Sketch.excalidraw"]')!;
      root.remove();
      expect(embed.querySelector("img, svg, canvas, a")).not.toBeNull();
    },
  );
});

describe("J-10: Markdown in a callout title (toimprove 219)", () => {
  const title = (md: string) => {
    const div = document.createElement("div");
    div.innerHTML = sanitizeNoteHtml(
      renderNoteHtml(md, {
        resolve: (t) => (t === "Other" ? "Other.md" : null),
        highlight: false,
        math: true,
      }),
      { remoteImages: false },
    );
    return div.querySelector(".callout-title")!;
  };
  it("sanity: an empty title is the type's name", () => {
    expect(title("> [!NOTE]\n> body").textContent).toBe("Note");
  });
  it("bold and a wikilink in the title are rendered", () => {
    const t = title("> [!tip] Read **this** and [[Other]]\n> body");
    expect(t.querySelector("strong")?.textContent).toBe("this");
    expect(t.querySelector("a.wikilink")?.getAttribute("data-path")).toBe(
      "Other.md",
    );
    expect(t.textContent).not.toContain("**");
  });
  it("inline code in the title is code", () => {
    expect(
      title("> [!info] Has `code`\n> b").querySelector("code"),
    ).not.toBeNull();
  });
});

describe("J-11: footnotes of an embedded note (toimprove 222)", () => {
  it.fails(
    "the host's footnote number reaches the host's footnote, not the embed's",
    async () => {
      const opts = {
        resolve: (t: string) => (t === "Other" ? "Other.md" : null),
        highlight: false,
        math: true,
      };
      const render = (md: string) =>
        sanitizeNoteHtml(renderNoteHtml(md, opts), { remoteImages: false });
      const root = document.createElement("div");
      root.innerHTML = render(
        "![[Other]]\n\nHost claim[^1].\n\n[^1]: host source",
      );
      document.body.append(root);
      await hydrateEmbeds(root, {
        imageUrl: async () => null,
        noteText: async () => "Other claim[^1].\n\n[^1]: other source",
        renderNested: (t: string) => render(t),
        afterNested: async () => {},
      } as never);
      // What NoteView.onReadingClick does for a footnote number: the first element with that id.
      const ref = [
        ...root.querySelectorAll<HTMLAnchorElement>("a[data-footnote]"),
      ].find((a) => !a.closest(".note-embed") && a.closest("sup"))!;
      const target = root.querySelector(`[id="${ref.dataset.footnote}"]`);
      root.remove();
      expect(target?.textContent).toContain("host source");
    },
  );
});

describe("J-13: line breaks right under a callout title (toimprove 229)", () => {
  const md =
    "> [!note] Title\n> line one\n> line two\n>\n> para two a\n> para two b";
  it("sanity: a later paragraph in the callout breaks its lines", () => {
    expect(html(md)).toContain("para two a<br>para two b");
  });
  it.fails(
    "the first lines under the title break too (strict line breaks off)",
    () => {
      expect(html(md)).toMatch(/line one<br>\s*line two/);
    },
  );
});
