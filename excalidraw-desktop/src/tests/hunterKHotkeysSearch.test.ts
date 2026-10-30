/**
 * Hunter K (2026-10-30), K-4: the Hotkeys page's search box matches the typed text as ONE
 * substring of "title / id / category", so words in another order or with a word between
 * them find nothing: "toggle mode" does not find "Toggle light/dark mode". This app's own
 * Settings search (`searchSettings`) matches every typed word in any order, and the palette
 * (Cmd+Shift+P) finds it by fuzzy match, as Zed's keymap editor and Obsidian's command search do. A user who searched the palette for a
 * command cannot find it again on the page where they would bind it.
 */
import { describe, expect, it } from "vitest";

import { COMMANDS } from "../commands/commands";
import { filter as fuzzyFilter, prepare } from "../commands/fuzzy";
import {
  filterInfos,
  type HotkeyInfo,
} from "../components/settings/pages/hotkeysView";

const infos: HotkeyInfo[] = COMMANDS.map((command) => ({
  command,
  keys: [],
  customised: false,
  conflicted: false,
}));

const page = (text: string) =>
  filterInfos(infos, { text, chord: null, filter: "all" }).map(
    (i) => i.command.id,
  );

const palette = (text: string) =>
  fuzzyFilter(
    COMMANDS.map((c) => ({ c, p: prepare(c.title) })),
    text,
    (x) => x.p,
    COMMANDS.length,
  ).map((r) => r.item.c.id);

const ROWS: [string, string][] = [
  ["toggle mode", "appearance.toggleMode"],
  ["mode toggle", "appearance.toggleMode"],
];

describe("hunter K-4: the Hotkeys search finds a command by its words", () => {
  it("sanity: one exact phrase works, and the palette finds every row", () => {
    expect(page("light/dark")).toContain("appearance.toggleMode");
    expect(palette("toggle mode")).toContain("appearance.toggleMode");
  });

  it.fails.each(ROWS)("toimprove 223: %s finds %s", (text, id) => {
    expect(page(text)).toContain(id);
  });
});
