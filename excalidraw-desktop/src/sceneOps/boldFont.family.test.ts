/**
 * Family (hunter A-5): "a bold text keeps its family's name and stays bold", for every place that
 * reads or writes a text's font outside the editor. Bold text is the family's bold variant
 * (id + 100, `boldFontOf`); a check against a plain id misses it.
 * Members: the plugin scene read (`scene.get` details), a plugin font update, the import's
 * "Update to my theme and font" (importUpgrade/hunterABold.test.ts) and the editor's font picker
 * (packages/excalidraw/actions/actionProperties.test.tsx).
 */
import { describe, expect, it } from "vitest";

import { FONT_FAMILY, boldFontOf } from "@excalidraw/common";
import { newElementWith } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { applyOps } from "./apply";
import { sceneDetails } from "./project";
import { stubApi } from "./testUtils";

const KEY = "plugins.test";

const addText = (fontFamily: "Excalifont" | "Nunito" | "Comic Shanns") => {
  const { api, updateScene } = stubApi([]);
  const r = applyOps(
    api,
    [
      {
        op: "add",
        ref: "t",
        element: { type: "text", text: "Title", fontFamily },
      },
    ],
    { dataKey: KEY },
  );
  const els = updateScene.mock.calls[0][0].elements as ExcalidrawElement[];
  const t = els.find((e) => e.id === r.refs.t)! as ExcalidrawTextElement;
  // Bold as the Markdown import and Markdown typing write it.
  return newElementWith(t, {
    fontFamily: boldFontOf(t.fontFamily) as never,
  }) as ExcalidrawTextElement;
};

const FAMILIES = ["Excalifont", "Nunito", "Comic Shanns"] as const;

describe("bold text: plugins see the family and a new family keeps it bold", () => {
  it.each(FAMILIES)("scene.get names a bold %s text by its family", (name) => {
    const t = addText(name);
    const [detail] = sceneDetails([t], [t.id]);
    expect(detail.fontFamily).toBe(name);
  });

  it.each([
    ["Excalifont", "Nunito"],
    ["Nunito", "Cascadia"],
    ["Comic Shanns", "Excalifont"],
  ] as const)("a bold %s text updated to %s stays bold", (from, to) => {
    const t = addText(from);
    const { api, updateScene } = stubApi([t]);
    applyOps(api, [{ op: "update", id: t.id, props: { fontFamily: to } }], {
      dataKey: KEY,
    });
    const out = (
      updateScene.mock.calls[0][0].elements as ExcalidrawElement[]
    ).find((e) => e.id === t.id) as ExcalidrawTextElement;
    expect(out.fontFamily).toBe(boldFontOf(FONT_FAMILY[to]));
  });

  it("a regular text updated to another family stays regular", () => {
    const { api, updateScene } = stubApi([]);
    const r = applyOps(
      api,
      [
        {
          op: "add",
          ref: "t",
          element: { type: "text", text: "a", fontFamily: "Nunito" },
        },
      ],
      { dataKey: KEY },
    );
    const t = (updateScene.mock.calls[0][0].elements as ExcalidrawElement[])[0];
    const second = stubApi([t]);
    applyOps(
      second.api,
      [{ op: "update", id: r.refs.t, props: { fontFamily: "Cascadia" } }],
      { dataKey: KEY },
    );
    const out = second.updateScene.mock.calls[0][0]
      .elements[0] as ExcalidrawTextElement;
    expect(out.fontFamily).toBe(FONT_FAMILY.Cascadia);
  });
});
