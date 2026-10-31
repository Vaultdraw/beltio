/**
 * Family hunter shell (2026-10-31), more members of "every type-to-filter list matches each word
 * in any order with case and accents folded" (`filterWords.family.test.ts` has the first five).
 * These are the filters that go through the shared fuzzy matcher (Cmd+P files and commands, the
 * open-tab list), the Move dialog's folder filter, and the Hotkeys page filter. A broken member
 * is `it.fails` with its toimprove number and flips to a pass when fixed. Not here: the tag
 * rename picker (inline in the component, toimprove 246) and the graph filter (its own term
 * grammar, covered by the graph plugin's `filters.test.ts`).
 */
import { describe, expect, it } from "vitest";

import { filter, prepare } from "../commands/fuzzy";
import { moveRows } from "../components/moveTree";
import { filterInfos } from "../components/settings/pages/hotkeysView";
import { prepareDrawings, prepareItems, rankRows } from "../palette/rank";

import type { PaletteItem } from "../palette/types";
import type { HotkeyInfo } from "../components/settings/pages/hotkeysView";
import type { CommandDefinition } from "../commands/types";

type Filter = (names: string[], query: string) => string[];

const MEMBERS: {
  name: string;
  filter: Filter;
  broken?: { words?: string; fold?: string };
}[] = [
  {
    name: "open-tab list (fuzzy filter)",
    filter: (names, q) =>
      filter(
        names.map((n) => ({ n, p: prepare(n) })),
        q,
        (x) => x.p,
        50,
      ).map((r) => r.item.n),
  },
  {
    name: "Cmd+P files (rankRows, files mode)",
    filter: (names, q) =>
      rankRows(prepareDrawings(names), prepareItems([]), q, [])
        .filter((r) => r.kind === "drawing")
        .map((r) => (r.kind === "drawing" ? r.drawing.path : "")),
  },
  {
    name: "Cmd+P commands (rankRows, commands mode)",
    filter: (names, q) =>
      rankRows(
        prepareDrawings([]),
        prepareItems(
          names.map(
            (n) =>
              ({ key: `command:${n}`, title: n, group: "x" } as PaletteItem),
          ),
        ),
        `>${q}`,
        [],
      ).map((r) => (r.kind === "item" ? r.entry.item.title : "")),
  },
  {
    name: "Move dialog folder filter (moveRows)",
    filter: (names, q) =>
      moveRows(names, new Set(), q)
        .filter((r) => r.matches)
        .map((r) => r.entry.path),
    broken: { words: "toimprove 303" },
  },
  {
    name: "Hotkeys page filter (filterInfos)",
    filter: (names, q) =>
      filterInfos(
        names.map(
          (n) =>
            ({
              command: {
                id: "x",
                title: n,
                category: "c",
              } as CommandDefinition,
              keys: [],
              customised: false,
              conflicted: false,
            } as HotkeyInfo),
        ),
        { text: q, chord: null, filter: "all" },
      ).map((i) => i.command.title),
  },
];

const NAMES = ["Catppuccin Mocha", "Café Notes", "Nord"];

describe("family (shell hunter): more type-to-filter lists match words in any order, folded", () => {
  for (const m of MEMBERS) {
    (m.broken?.words ? it.fails : it)(`${m.name}: words in any order`, () => {
      expect(m.filter(NAMES, "mocha catppuccin")).toEqual(["Catppuccin Mocha"]);
    });
    (m.broken?.fold ? it.fails : it)(`${m.name}: accents folded`, () => {
      expect(m.filter(NAMES, "cafe")).toEqual(["Café Notes"]);
    });
    it(`${m.name}: plain substring still matches`, () => {
      expect(m.filter(NAMES, "noR")).toEqual(["Nord"]);
    });
  }
});
