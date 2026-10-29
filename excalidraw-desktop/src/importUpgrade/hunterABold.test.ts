import { describe, expect, it } from "vitest";

import { upgradeScene } from "./upgradeScene";

import type { UpgradeTarget } from "./upgradeScene";

// Hunter A round 2: "Update to my theme and font" on a note imported WITH bold headings
// (heading_bold and bold_text are on by default). Bold text is stored as family id + 100.
const MARK = { "plugins.markdown-import": { heading: 1 } };
const text = (id: string, fontFamily: number, extra = {}) => ({
  id,
  type: "text",
  text: id,
  fontFamily,
  version: 3,
  ...extra,
});
const TARGET: UpgradeTarget = {
  look: {
    paperTheme: "match",
    viewBackgroundColor: "#18191c",
    viewBackgroundPattern: null,
  },
  fontFamily: 6, // Nunito
};

describe("upgradeScene: bold text of a new import takes the user's font too", () => {
  it("a bold heading and a whole-bold paragraph follow the body to the new font (bold variant)", () => {
    const scene = {
      type: "excalidraw",
      version: 2,
      appState: {
        pageSetup: {
          enabled: true,
          width: 794,
          height: 1123,
          layout: "separate",
          orientation: "portrait",
          pageCount: 1,
          paperTheme: "match",
          size: "a4",
        },
      },
      elements: [
        text("Heading", 105, { customData: MARK }),
        text("body", 5),
        text("All bold paragraph", 105),
      ],
      files: {},
    };
    const out = upgradeScene(JSON.stringify(scene), TARGET, true);
    expect(out).not.toBeNull();
    const fam = Object.fromEntries(
      (
        JSON.parse(out!.json).elements as { id: string; fontFamily: number }[]
      ).map((e) => [e.id, e.fontFamily]),
    );
    expect(fam.body).toBe(6);
    expect(fam.Heading).toBe(106);
    expect(fam["All bold paragraph"]).toBe(106);
  });
});
