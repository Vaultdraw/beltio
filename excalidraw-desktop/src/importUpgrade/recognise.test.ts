import { describe, expect, it } from "vitest";

import { importFolders, inFolders, recognise } from "./recognise";

const MARK = { "plugins.markdown-import": { heading: 1 } };
const scene = (elements: unknown[], over: object = {}) => ({
  source: "tauri://localhost",
  appState: { pageSetup: { enabled: true } },
  elements,
  ...over,
});
const el = (type: string, x = 56, created = 7, extra = {}) => ({
  id: `${type}${x}${created}`,
  type,
  x,
  created,
  ...extra,
});

// One row per drawing shape in the owner's vault (read-only scan, 2026-10-29: 883 marked, 232 by
// shape, 20 empty in an imported folder, 54 not imports).
describe("recognise", () => {
  it.each([
    [
      "marked heading",
      scene([el("text", 56, 1, { customData: MARK })]),
      false,
      "marked",
    ],
    [
      "marked, edited afterwards",
      scene([el("text", 56, 1, { customData: MARK }), el("arrow", 300, 9)]),
      false,
      "marked",
    ],
    [
      "poem: texts at the margin, one stamp",
      scene([el("text"), el("text")]),
      false,
      "shape",
    ],
    [
      "note with a picture and a table",
      scene([el("text"), el("image", 56), el("rectangle", 56), el("line", 56)]),
      false,
      "shape",
    ],
    [
      "Data Modelling: text and picture, nonces changed by the editor",
      scene([el("text", 56), el("image", 93)]),
      false,
      "shape",
    ],
    ["empty note in an imported folder", scene([]), true, "emptyInImport"],
    ["empty drawing elsewhere", scene([]), false, null],
    [
      "a shape added later",
      scene([el("text"), el("text", 300, 99)]),
      false,
      null,
    ],
    [
      "an arrow (the import draws none)",
      scene([el("text"), el("arrow")]),
      false,
      null,
    ],
    [
      "something deleted since",
      scene([el("text"), el("text", 56, 7, { isDeleted: true })]),
      false,
      null,
    ],
    [
      "one text typed by hand mid-page (Todo)",
      scene([el("text", 152)]),
      false,
      null,
    ],
    ["page mode off", scene([el("text")], { appState: {} }), false, null],
    [
      "Obsidian Excalidraw plugin drawing",
      scene([el("text")], {
        source: "https://github.com/zsviczian/obsidian-excalidraw-plugin",
      }),
      false,
      null,
    ],
  ])("%s", (_name, s, inImport, want) => {
    expect(recognise(s as never, inImport as boolean)).toBe(want);
  });
});

describe("import folders", () => {
  it("are the folders holding an import report, with everything below them", () => {
    const f = importFolders([
      "Obsidian/Import report.excalidraw",
      "Obsidian/Obsidian/Import report.excalidraw",
      "Mine/Import report notes.excalidraw",
    ]);
    expect([...f].sort()).toEqual(["Obsidian", "Obsidian/Obsidian"]);
    expect(inFolders("Obsidian/Poems/a.excalidraw", f)).toBe(true);
    expect(inFolders("ObsidianX/a.excalidraw", f)).toBe(false);
    expect(
      inFolders("a.excalidraw", importFolders(["Import report.excalidraw"])),
    ).toBe(true);
  });
});
