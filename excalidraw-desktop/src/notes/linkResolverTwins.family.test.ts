/**
 * Family "twin parsers": the reading view resolves `[[target]]` with `notes/noteLinks.ts`; the
 * graph, backlinks and the unresolved list use the native resolver, whose TypeScript twin is
 * `links/resolve.ts` (same fold as `fold_cases.json`). A link must open the same file in all of
 * them (toimprove 314: the reading view does not fold accents, ß, ø, full-width, kana). Table rows run against both TypeScript copies; `broken` rows are `it.fails`.
 */
import { describe, expect, it } from "vitest";

import foldTable from "../../src-tauri/crates/vaultdraw-core/src/contract/fold_cases.json";
import { LinkResolver } from "../links/resolve";

import { createNoteLinkIndex } from "./noteLinks";

type Case = {
  name: string;
  paths: string[];
  from: string;
  typed: string;
  want: string | null;
};

const cases: Case[] = [
  {
    name: "ascii case",
    paths: ["Home.excalidraw"],
    from: "a.md",
    typed: "home",
    want: "Home.excalidraw",
  },
  {
    name: "partial path",
    paths: ["Graphs/BFS.excalidraw"],
    from: "a.md",
    typed: "graphs/bfs",
    want: "Graphs/BFS.excalidraw",
  },
  {
    name: "relative",
    paths: ["P/Plan.excalidraw", "Home.excalidraw"],
    from: "P/a.md",
    typed: "../Home",
    want: "Home.excalidraw",
  },
  {
    name: "unknown",
    paths: ["Home.excalidraw"],
    from: "a.md",
    typed: "Nope",
    want: null,
  },
  {
    name: "leading slash",
    paths: ["Home.excalidraw"],
    from: "a.md",
    typed: "/Home",
    want: "Home.excalidraw",
  },
  {
    name: "spaces around",
    paths: ["Home.excalidraw"],
    from: "a.md",
    typed: "  Home  ",
    want: "Home.excalidraw",
  },
  {
    name: "decomposed typed, composed file",
    paths: ["Café.excalidraw"],
    from: "a.md",
    typed: "Café",
    want: "Café.excalidraw",
  },
  {
    name: "composed typed, decomposed file",
    paths: ["Café.excalidraw"],
    from: "a.md",
    typed: "Café",
    want: "Café.excalidraw",
  },
  {
    name: "typed without the accent",
    paths: ["Café.excalidraw"],
    from: "a.md",
    typed: "cafe",
    want: "Café.excalidraw",
  },
  {
    name: "the extension typed",
    paths: ["Home.excalidraw"],
    from: "a.md",
    typed: "Home.excalidraw",
    want: "Home.excalidraw",
  },
  {
    name: "wrong extension typed",
    paths: ["Home.excalidraw"],
    from: "a.md",
    typed: "Home.md",
    want: null,
  },
];

const resolveNote = (c: Case) =>
  createNoteLinkIndex(c.paths).resolve(c.from, c.typed);
const resolveLink = (c: Case) =>
  new LinkResolver(c.paths).resolveTarget(c.from, c.typed).path;

describe("a link opens the same file in the reading view and in the link resolver", () => {
  for (const c of cases) {
    it(`${c.name}: reading view`, () => expect(resolveNote(c)).toBe(c.want));
    it(`${c.name}: link resolver`, () => expect(resolveLink(c)).toBe(c.want));
  }
});

describe("the reading view folds a typed link like the search index (fold_cases.json)", () => {
  for (const r of foldTable.cases as {
    label: string;
    input: string;
    folded: string;
  }[]) {
    it(`${r.label}: [[${r.folded}]] opens ${r.input}.md`, () => {
      const idx = createNoteLinkIndex([`${r.input}.md`]);
      expect(idx.resolve("x.md", r.folded)).toBe(`${r.input}.md`);
    });
  }
});
