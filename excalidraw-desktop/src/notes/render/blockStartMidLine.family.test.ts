/**
 * Family (validator, 2026-10-30, review of f38b8be4 and 6a0f5936): a block-level renderer
 * extension whose `start()` returns an index in the MIDDLE of a line makes marked cut the
 * paragraph there and glue the pieces back with an extra "\n". The reading view then shows a
 * line break the note does not have, and the task map (built from the same tokens) counts one
 * line too many, so a click on a checkbox ticks a LATER task and saves it (toimprove 202).
 * Members: `commentBlock` (`%%`), `blockMath` (`$$`) in render/obsidian.ts.
 * Fixed (toimprove 202): every block extension starts only at a line start.
 */
import { describe, expect, it } from "vitest";

import { taskLines, toggleTask } from "../noteTasks";

import { lexNote, renderNoteHtml } from "./obsidian";

const render = (md: string) =>
  renderNoteHtml(md, { resolve: () => null, highlight: false, math: true });

/** A construct written in the middle of a line of a paragraph. */
const MID_LINE: [name: string, md: string][] = [
  ["inline %%comment%%", "Text %%private%% more text."],
  ["two %% in prose", "Growth was 5%% this year and 7%% next."],
  ["$$ in prose", "It costs 5$$ or 6$$ each."],
  ["inline [[link]]", "See [[Other note]] for more."],
  ["inline ==highlight==", "A ==marked== word here."],
  ["inline $math$", "Area $x^2$ grows."],
  ["inline footnote", "A claim[^1] stands.\n\n[^1]: Source."],
  ["inline ![[embed]]", "See ![[pic.png]] here."],
];

describe("block extensions start only at a line start (family: mid-line block start)", () => {
  for (const [name, md] of MID_LINE) {
    it(`${name}: the lexed blocks cover the note exactly (no extra line)`, () => {
      const { tokens } = lexNote(md);
      expect(tokens.map((t) => t.raw).join("")).toBe(md);
    });
    it(`${name}: no line break appears that the note does not have`, () => {
      expect(render(md.split("\n")[0])).not.toContain("<br");
    });
  }
});

describe("a checkbox ticks its own task when prose above has a mid-line construct", () => {
  const rows: [string, string][] = [
    ["%%comment%%", "Para %%c%% end\n- [ ] one\n- [ ] two\n- [ ] three"],
    ["$$", "Cost 5$$ or 6$$ each\n- [ ] one\n- [ ] two"],
    ["[[link]]", "Para [[x]] end\n- [ ] one\n- [ ] two"],
  ];
  for (const [name, md] of rows) {
    it(`${name}: the first checkbox ticks "one", nothing else`, () => {
      expect(taskLines(md)).toEqual(
        [1, 2, 3].slice(0, md.split("\n").length - 1),
      );
      const next = toggleTask(md, 0);
      expect(next).toBe(md.replace("- [ ] one", "- [x] one"));
    });
  }
});

describe("block constructs at a line start still work", () => {
  it("a %% block of lines in a paragraph's middle is hidden", () => {
    const html = render("Before\n%%\nsecret\n%%\nAfter");
    expect(html).not.toContain("secret");
    expect(html).toContain("Before");
    expect(html).toContain("After");
  });
  it("a $$ block on its own lines is display math", () => {
    expect(render("Text\n$$\nx^2\n$$\nmore")).toContain('data-display="1"');
  });
  it("a footnote definition right under prose is listed, not shown inline", () => {
    const html = render("A claim[^1].\n[^1]: Source.");
    expect(html).not.toMatch(/<p>[^<]*\[\^1\]:/);
    expect(html).toContain("Source.");
  });
  it("the task map stays right below a $$ block", () => {
    const md = "$$\nx\n$$\n- [ ] one\n- [ ] two";
    expect(toggleTask(md, 1)).toBe(md.replace("- [ ] two", "- [x] two"));
  });
});
