// @vitest-environment jsdom
/**
 * Family "no note text can break the reading view" (the Rust parser already has hostile-note rows,
 * hunter A-12; the TypeScript renderer had none). A note is user text, often pasted: a mail thread
 * with 6,000 lines of `> > >`, a long run of `>`. `renderNoteHtml` runs inside a React `useMemo`
 * with no error boundary above the note view, so a throw there unmounts the window. Each row is
 * a hostile shape (toimprove 296, fixed: such a note is read in parts, `byParts` in obsidian.ts).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lexNote, renderNoteHtml } from "./render/obsidian";
import { taskLines } from "./noteTasks";
import { FakeNoteFiles } from "./FakeNoteFiles";
import { setNoteFiles } from "./noteBackend";
import NoteView from "./NoteView";

const lines = (n: number, f: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => f(i)).join("\n");

const HOSTILE: Record<string, { md: string; broken?: boolean }> = {
  "2,000 quote marks on one line": {
    md: `${">".repeat(2000)} x`,
  },
  "1,600 quote lines of changing depth": {
    md: lines(1600, (i) => `${">".repeat((i % 6) + 1)} deep ${i}`),
  },
  "25,600 quote lines of changing depth": {
    md: lines(25600, (i) => `${">".repeat((i % 6) + 1)} deep ${i}`),
  },
  "12,800 quote lines of two depths": {
    md: lines(12800, (i) => `${i % 2 ? ">>" : ">"} t ${i}`),
  },
  "1,600 mail-thread lines": {
    md: lines(1600, (i) => `${"> ".repeat((i % 3) + 1)}text ${i}`),
  },
  "25,600 mail-thread lines": {
    md: lines(25600, (i) => `${"> ".repeat((i % 3) + 1)}text ${i}`),
  },
  "list nested 400 deep": {
    md: lines(400, (i) => `${"  ".repeat(i)}- n ${i}`),
  },
  "2,000 open square brackets": { md: `${"[".repeat(2000)}x](u)` },
  "2,000 open wikilinks": { md: "[[".repeat(2000) },
  "20,000 open parentheses": { md: "(".repeat(20000) },
  "2,000 open html tags": { md: `${"<div>".repeat(2000)}x` },
  "a table with 5,000 columns": {
    md: `|${"a|".repeat(5000)}\n|${"-|".repeat(5000)}\n|${"b|".repeat(5000)}`,
  },
  "a 1 MB line with no break": { md: "word ".repeat(200_000) },
};

const ctx = { resolve: () => null, highlight: false, math: true };

describe("hostile notes render without throwing (renderNoteHtml, lexNote, taskLines)", () => {
  for (const [name, { md, broken }] of Object.entries(HOSTILE)) {
    (broken ? it.fails : it)(
      name,
      () => {
        expect(() => renderNoteHtml(md, ctx)).not.toThrow();
        expect(() => lexNote(md, true)).not.toThrow();
        expect(() => taskLines(md, true)).not.toThrow();
      },
      60_000,
    );
  }
});

describe("what a hostile note shows (toimprove 296)", () => {
  it("a long mail thread keeps its quotes, every line, and is fast", () => {
    const md = lines(25600, (i) => `${"> ".repeat((i % 3) + 1)}text ${i}`);
    const t = performance.now();
    const html = renderNoteHtml(md, ctx);
    expect(performance.now() - t).toBeLessThan(5000);
    expect(html).toContain("<blockquote>");
    expect(html).toContain("text 0");
    expect(html).toContain("text 25599");
  });

  it("a line of 2,000 quote marks does not take the rest of the note's formatting with it", () => {
    const html = renderNoteHtml(
      `# Title\n\n${">".repeat(2000)} x\n\n**after**`,
      ctx,
    );
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>after</strong>");
    expect(html).toContain("x");
  });

  it("tasks in a long quote: each drawn checkbox is a task line", () => {
    const md = lines(1000, (i) =>
      i % 10 ? `> line ${i}` : `> - [ ] task ${i}`,
    );
    const html = renderNoteHtml(md, ctx);
    const boxes = (html.match(/type="checkbox"/g) ?? []).length;
    const tasks = taskLines(md);
    expect(boxes).toBe(100);
    expect(tasks).toEqual(Array.from({ length: 100 }, (_, i) => i * 10));
  });

  it("an ordinary note is read in one go (reference links resolve across the note)", () => {
    const md = `${lines(
      500,
      (i) => `para ${i}\n`,
    )}\n[x][r]\n\n[r]: https://example.com`;
    expect(renderNoteHtml(md, ctx)).toContain('href="https://example.com"');
  });
});

describe("byParts fallback", () => {
  it("a block the library cannot read shows as escaped plain text", () => {
    // 20,000 quote marks overflow the library's recursion even alone.
    const html = renderNoteHtml(
      `ok\n\n${">".repeat(20000)} <b>x</b>\n\n*end*`,
      ctx,
    );
    expect(html).toContain('class="note-raw"');
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("<em>end</em>");
    expect(taskLines(`${">".repeat(20000)} - [ ] t\n\n- [ ] real`)).toEqual([
      2,
    ]);
  });
});

describe("the note view survives a hostile note", () => {
  afterEach(() => {
    cleanup();
    setNoteFiles(null);
  });
  it("a note of 2,000 quote marks still opens in the reading view (toimprove 296)", async () => {
    // React rethrows a render error to the window; keep it out of the run's unhandled errors.
    const swallow = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener("error", swallow);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const files = new FakeNoteFiles();
    files.setOnDisk("n.md", `# Title\n\n${">".repeat(2000)} x\n\nafter`);
    setNoteFiles(files);
    render(
      <NoteView
        path="n.md"
        openPath={() => undefined}
        vault={{ handle: "h", paths: () => ["n.md"] }}
      />,
    );
    const reading = await screen.findByTestId("note-reading");
    expect(reading.textContent).toContain("after");
    window.removeEventListener("error", swallow);
  });
});

describe("the note view's error boundary (toimprove 296)", () => {
  afterEach(() => {
    cleanup();
    setNoteFiles(null);
  });
  it("shows a plain message when drawing throws, and Open as text opens the editor", async () => {
    const swallow = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener("error", swallow);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const files = new FakeNoteFiles();
    files.setOnDisk("n.md", "# Title\n\nbody");
    setNoteFiles(files);
    let boom = true;
    render(
      <NoteView
        path="n.md"
        openPath={() => undefined}
        vault={{
          handle: "h",
          paths: () => {
            if (boom) {
              throw new Error("boom");
            }
            return ["n.md"];
          },
        }}
      />,
    );
    const err = await screen.findByTestId("note-error");
    expect(err.textContent).toContain("This note couldn't be displayed");
    boom = false;
    window.removeEventListener("error", swallow);
    screen.getByRole("button", { name: "Open as text" }).click();
    expect(await screen.findByLabelText("Show reading view")).toBeTruthy();
  });
});
