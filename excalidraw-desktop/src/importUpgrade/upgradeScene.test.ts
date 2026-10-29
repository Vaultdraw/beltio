import { describe, expect, it } from "vitest";

import {
  hasOldLook,
  importFontFamily,
  isImportedScene,
  upgradeScene,
  webPictureBoxes,
} from "./upgradeScene";

import type { UpgradeTarget } from "./upgradeScene";

const MARK = { "plugins.markdown-import": { heading: 1 } };
const page = (paperTheme: string) => ({
  enabled: true,
  width: 794,
  height: 1123,
  layout: "separate",
  orientation: "portrait",
  pageCount: 1,
  paperTheme,
  size: "a4",
});
const text = (id: string, fontFamily: number, extra = {}) => ({
  id,
  type: "text",
  text: id,
  fontFamily,
  version: 3,
  ...extra,
});

/** Drawings as older versions wrote them (shapes taken from the owner's imported notes). */
const FIXTURES = {
  // Before 5fee99a8: a white "normal" page, Excalifont body, Cascadia code, no background colour.
  pre5fee99a8: {
    type: "excalidraw",
    version: 2,
    appState: { pageSetup: page("normal") },
    elements: [
      text("Heading", 5, { customData: MARK }),
      text("body", 5),
      text("code", 3),
      {
        id: "box",
        type: "rectangle",
        link: "https://e.x/a.png",
        width: 480,
        height: 300,
      },
      text("Web image: a", 5, { link: "https://e.x/a.png" }),
    ],
    files: {},
  },
  // Opened and saved once by the old app: an explicit white background.
  savedByOldApp: {
    type: "excalidraw",
    version: 2,
    appState: { pageSetup: page("normal"), viewBackgroundColor: "#ffffff" },
    elements: [text("Heading", 5, { customData: MARK }), text("body", 5)],
    files: {},
  },
  // A drawing the user made: never touched, whatever its page and font.
  userDrawing: {
    type: "excalidraw",
    version: 2,
    appState: { pageSetup: page("normal") },
    elements: [text("mine", 5)],
    files: {},
  },
  // Imported by the current version: already follows the vault.
  currentImport: {
    type: "excalidraw",
    version: 2,
    appState: { pageSetup: page("match"), viewBackgroundColor: "#18191c" },
    elements: [text("Heading", 3, { customData: MARK }), text("body", 3)],
    files: {},
  },
};

const TARGET: UpgradeTarget = {
  look: {
    paperTheme: "match",
    viewBackgroundColor: "#18191c",
    viewBackgroundPattern: null,
  },
  fontFamily: 3,
};

const run = (scene: object, t = TARGET) =>
  upgradeScene(JSON.stringify(scene), t);

describe("upgradeScene: drawings written by older versions", () => {
  it.each([
    ["pre5fee99a8", true, 3],
    ["savedByOldApp", true, 2],
    ["userDrawing", false, 0],
    ["currentImport", false, 0],
  ] as const)("%s: upgraded %s, %i texts refonted", (name, upgraded, fonts) => {
    const out = run(FIXTURES[name]);
    expect(out !== null).toBe(upgraded);
    if (!out) {
      return;
    }
    const scene = JSON.parse(out.json);
    expect(out.fonts).toBe(fonts);
    expect(scene.appState.pageSetup.paperTheme).toBe("match");
    expect(scene.appState.viewBackgroundColor).toBe("#18191c");
    // Code keeps Cascadia; nothing is left in Excalifont.
    expect(
      scene.elements.filter((e: { fontFamily?: number }) => e.fontFamily === 5),
    ).toEqual([]);
    // Other page fields, links, boxes and files stay as they were.
    expect(scene.appState.pageSetup.pageCount).toBe(1);
    expect(scene.elements).toHaveLength(FIXTURES[name].elements.length);
    expect(scene.files).toEqual({});
    // Running it again changes nothing (idempotent).
    expect(upgradeScene(out.json, TARGET)).toBeNull();
  });

  it("a user who draws in Excalifont keeps it; only the page changes", () => {
    const out = run(FIXTURES.pre5fee99a8, { ...TARGET, fontFamily: 5 });
    expect(out?.fonts).toBe(0);
    expect(out?.paper).toBe(true);
  });

  it("a user who wants the white page keeps it; only the font changes", () => {
    const t = {
      ...TARGET,
      look: { ...TARGET.look, paperTheme: "normal" as const },
    };
    const out = run(FIXTURES.pre5fee99a8, t);
    expect(out?.paper).toBe(false);
    expect(JSON.parse(out!.json).appState.viewBackgroundColor).toBeUndefined();
  });

  it("deleted texts and broken JSON are left alone", () => {
    expect(upgradeScene("{not json", TARGET)).toBeNull();
    const scene = {
      ...FIXTURES.currentImport,
      elements: [
        text("Heading", 3, { customData: MARK }),
        text("gone", 5, { isDeleted: true }),
      ],
    };
    expect(run(scene)).toBeNull();
  });

  it("detects imports by the mark only", () => {
    expect(isImportedScene(FIXTURES.pre5fee99a8)).toBe(true);
    expect(isImportedScene(FIXTURES.userDrawing)).toBe(false);
    expect(hasOldLook(FIXTURES.currentImport, TARGET)).toBe(false);
  });
});

describe("the import's font setting and web pictures", () => {
  it.each([
    ["default", 6, 6],
    [undefined, 6, 6],
    ["document", 6, 9],
    ["excalifont", 6, 5],
    ["cascadia", 6, 3],
    ["unknown", 2, 2],
  ])("font %s with drawing font %i -> %i", (setting, drawing, want) => {
    expect(importFontFamily(setting, drawing)).toBe(want);
  });

  it("a user whose import font is Excalifont keeps it", () => {
    const out = run(FIXTURES.pre5fee99a8, {
      ...TARGET,
      fontFamily: importFontFamily("excalifont", 3),
    });
    expect(out?.fonts).toBe(0);
  });

  it("counts only https boxes with a Web image label of the same link", () => {
    expect(webPictureBoxes(FIXTURES.pre5fee99a8)).toBe(1);
    expect(webPictureBoxes(FIXTURES.userDrawing)).toBe(0);
    const local = {
      elements: [
        { id: "b", type: "rectangle", link: "pics/a.png" },
        text("Image not found: a", 5, { link: "pics/a.png" }),
        {
          id: "c",
          type: "rectangle",
          link: "https://e.x/b.png",
          isDeleted: true,
        },
        text("Web image: b", 5, { link: "https://e.x/b.png" }),
      ],
    };
    expect(webPictureBoxes(local)).toBe(0);
  });
});
