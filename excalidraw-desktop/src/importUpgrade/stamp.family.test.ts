/**
 * Family sweep (hunter A-2, 2026-10-30): "Re-import unchanged imported notes" rewrote notes the
 * user had moved, retyped or trimmed. Every kind of user edit must read as "edited"; the import
 * itself, a reload (drawing order filled in), the picture fill and "Update to my theme and font"
 * must read as "untouched"; a note imported before stamps must read as "unknown".
 */
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { describe, expect, it } from "vitest";

import { buildPageItems } from "../sceneOps/pageText";

import { editState, stampElements } from "./stamp";
import { upgradeScene } from "./upgradeScene";

import type { PageItem } from "../plugins/api";

type El = Record<string, any>;
type Scene = { elements: El[]; appState: Record<string, unknown> };

const ITEMS = [
  {
    type: "text",
    page: 0,
    x: 40,
    y: 40,
    width: 500,
    height: 50,
    text: "Title",
    fontSize: 40,
    fontFamily: "Excalifont",
    data: { role: "h1" },
  },
  {
    type: "text",
    page: 0,
    x: 40,
    y: 100,
    width: 500,
    height: 25,
    text: "A paragraph of the note",
    fontSize: 20,
    fontFamily: "Excalifont",
  },
  {
    type: "image",
    page: 0,
    x: 40,
    y: 140,
    width: 300,
    height: 200,
    mimeType: "",
    target: "https://example.com/cat.png",
    alt: "Web image: a cat",
  },
  {
    type: "line",
    page: 0,
    x: 40,
    y: 360,
    width: 500,
    height: 0,
  },
  {
    type: "rect",
    page: 0,
    x: 40,
    y: 380,
    width: 500,
    height: 60,
    fill: "code",
    stroke: "thin",
  },
] as unknown as PageItem[];

/** A note as the import writes it (`pagesContext` stamps in `sceneJson`), saved and read back. */
const imported = (): Scene => {
  const built = buildPageItems(ITEMS, { dataKey: "plugins.markdown-import" });
  stampElements(built.elements as never);
  return JSON.parse(
    JSON.stringify({
      elements: built.elements,
      appState: { pageSetup: { enabled: true, pageCount: 1 } },
    }),
  );
};

/** Opened in the editor and saved: restore fills in `index` and bumps version and updated. */
const reloaded = (s: Scene): Scene => ({
  ...s,
  elements: JSON.parse(
    JSON.stringify(restoreElements(s.elements as never, null)),
  ),
});

const byType = (s: Scene, type: string) =>
  s.elements.find((e) => e.type === type && !e.link)!;
const paragraph = (s: Scene) =>
  s.elements.find((e) => e.originalText === "A paragraph of the note")!;

const EDITS: [string, (s: Scene) => void][] = [
  ["move a text", (s) => (paragraph(s).x += 10)],
  [
    "move everything (select all, arrow)",
    (s) => s.elements.forEach((e) => (e.y += 5)),
  ],
  [
    "resize the rule",
    (s) => {
      byType(s, "line").width = 200;
      byType(s, "line").points = [
        [0, 0],
        [200, 0],
      ];
    },
  ],
  [
    "resize a box",
    (s) => {
      byType(s, "rectangle").height += 20;
    },
  ],
  [
    "retype a text",
    (s) => {
      const p = paragraph(s);
      p.originalText = "A changed paragraph";
      p.text = "A changed paragraph";
    },
  ],
  ["recolour a text", (s) => (paragraph(s).strokeColor = "#e03131")],
  ["change a font", (s) => (paragraph(s).fontFamily = 8)],
  ["change a size", (s) => (paragraph(s).fontSize = 28)],
  ["delete an element (saved files drop it)", (s) => s.elements.splice(1, 1)],
  ["delete the last element", (s) => s.elements.pop()],
  [
    "add an element",
    (s) =>
      s.elements.push({ ...paragraph(s), id: "mine", customData: undefined }),
  ],
  [
    "paste an element copied from another imported note",
    (s) => s.elements.push({ ...paragraph(imported()), id: "pasted" }),
  ],
  ["add a link", (s) => (paragraph(s).link = "https://example.com")],
  [
    "group two elements",
    (s) => s.elements.slice(0, 2).forEach((e) => (e.groupIds = ["g"])),
  ],
  ["lock an element", (s) => (paragraph(s).locked = true)],
  [
    "bring an element to the front (reorder)",
    (s) => s.elements.push(s.elements.splice(0, 1)[0]),
  ],
  ["rotate an element", (s) => (paragraph(s).angle = 0.5)],
  ["make an element transparent", (s) => (paragraph(s).opacity = 40)],
  [
    "delete without saving yet (isDeleted)",
    (s) => (paragraph(s).isDeleted = true),
  ],
];

/** The picture fill: the box and its label go, the downloaded picture is added at the end. */
const fillPicture = (s: Scene) => {
  const box = s.elements.findIndex((e) => e.type === "rectangle");
  const { x, y } = s.elements[box];
  s.elements.splice(box, 2);
  s.elements.push({
    id: "pic",
    type: "image",
    x,
    y,
    width: 300,
    height: 200,
    fileId: "f1",
    link: "https://example.com/cat.png",
  });
};

describe("import edit stamps (A-2): every user edit reads as edited", () => {
  it.each(EDITS)("%s", (_name, edit) => {
    const s = reloaded(imported());
    edit(s);
    expect(editState(s)).toBe("edited");
  });

  it.each(EDITS)("%s, after a picture fill", (_name, edit) => {
    const s = imported();
    fillPicture(s);
    const r = reloaded(s);
    edit(r);
    expect(editState(r)).toBe("edited");
  });
});

describe("import edit stamps (A-2): the app's own passes keep a note untouched", () => {
  it("as imported", () => {
    expect(editState(imported())).toBe("untouched");
  });
  it("opened and saved (drawing order filled in, versions bumped)", () => {
    expect(editState(reloaded(imported()))).toBe("untouched");
  });
  it("its web picture filled in", () => {
    const s = imported();
    fillPicture(s);
    expect(editState(reloaded(s))).toBe("untouched");
  });
  it("its placeholder relabelled by a failed download", () => {
    const s = imported();
    const label = s.elements.find((e) => e.text === "Web image: a cat")!;
    label.originalText = label.text = "Web page, not a picture: a cat";
    label.link = null;
    expect(editState(s)).toBe("untouched");
  });
  it("updated to my theme and font", () => {
    const out = upgradeScene(JSON.stringify(imported()), {
      look: {
        paperTheme: "match",
        viewBackgroundColor: "#18191c",
        viewBackgroundPattern: null,
      },
      fontFamily: 3,
    });
    expect(out).not.toBeNull();
    const s = JSON.parse(out!.json) as Scene;
    expect(s.elements.some((e) => e.fontFamily === 3)).toBe(true);
    expect(editState(reloaded(s))).toBe("untouched");
  });
  it("an edited note stays edited after a theme update", () => {
    const s = imported();
    paragraph(s).x += 10;
    const out = upgradeScene(JSON.stringify(s), {
      look: {
        paperTheme: "match",
        viewBackgroundColor: "#18191c",
        viewBackgroundPattern: null,
      },
      fontFamily: 3,
    });
    expect(editState(JSON.parse(out!.json))).toBe("edited");
  });
});

describe("import edit stamps (A-2): older imports", () => {
  it("a note imported before stamps cannot be judged", () => {
    const s = imported();
    s.elements.forEach((e) => delete e.customData?.["vaultdraw.import"]);
    expect(editState(s)).toBe("unknown");
  });
  it("a drawing the user made is unknown, not untouched", () => {
    expect(
      editState({ elements: [{ id: "a", type: "rectangle", x: 0, y: 0 }] }),
    ).toBe("unknown");
  });
});
