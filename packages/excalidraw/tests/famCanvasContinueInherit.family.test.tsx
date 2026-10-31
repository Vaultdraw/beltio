import { afterEach, describe, expect, it } from "vitest";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { getTextEditor } from "./queries/dom";
import { act, render, unmountComponent } from "./test-utils";

import type { TextEditorExtension, TextEditorSession } from "../types";

/**
 * Family hunter canvas (2026-10-31), family of toimprove 227: "a box made by continuing another
 * (Enter after a heading, a later line split into its own box) is part of the same thing".
 * 227 fixed groupIds and its text said "nor angle"; only the group got a row. One row per
 * property of the box being continued. `broken` rows are it.fails with the toimprove number.
 */
unmountComponent();

type Row = {
  name: string;
  from: Record<string, unknown>;
  /** the new box must hold the same value */
  prop: string;
  broken?: number;
};

const ROWS: Row[] = [
  { name: "group", from: { groupIds: ["card"] }, prop: "groupIds" },
  { name: "frame", from: { frameId: "frame-1" }, prop: "frameId" },
  { name: "opacity", from: { opacity: 40 }, prop: "opacity" },
  {
    name: "text colour",
    from: { strokeColor: "#e03131" },
    prop: "strokeColor",
  },
  {
    name: "highlight",
    from: { backgroundColor: "#ffec99" },
    prop: "backgroundColor",
  },
  { name: "alignment", from: { textAlign: "center" }, prop: "textAlign" },
  {
    name: "line height",
    from: { lineHeight: 1.6 as never },
    prop: "lineHeight",
  },
  { name: "rough style", from: { roughness: 2 }, prop: "roughness" },
  { name: "stroke width", from: { strokeWidth: 4 }, prop: "strokeWidth" },
  {
    name: "angle (a rotated card)",
    from: { angle: 0.4 as never },
    prop: "angle",
    broken: 299,
  },
];

describe("family: a continued box inherits what the box it continues has", () => {
  afterEach(() => unmountComponent());

  for (const row of ROWS) {
    const run = async () => {
      let session: TextEditorSession | null = null;
      const extension: TextEditorExtension = {
        attach: (s) => {
          session ??= s;
          return {};
        },
      };
      await render(
        <Excalidraw
          handleKeyboardGlobally={true}
          textEditorExtension={() => extension}
        />,
      );
      const heading = API.createElement({
        type: "text",
        text: "Title",
        x: 0,
        y: 0,
        ...(row.from as object),
      } as never);
      API.setElements([heading]);
      act(() => {
        window.h.app.text.startTextEditing({
          sceneX: 0,
          sceneY: 0,
          insertAtParentCenter: false,
          textElement: heading as never,
        });
      });
      await getTextEditor();
      act(() => {
        session!.continueInNewText({
          x: 0,
          y: 40,
          text: "Body",
          caret: 0,
          fontSize: 20,
        });
      });
      const body = window.h.elements.find(
        (e) => e.type === "text" && e.id !== heading.id && !e.isDeleted,
      ) as any;
      expect(body).toBeDefined();
      expect(body[row.prop]).toEqual((heading as any)[row.prop]);
    };
    (row.broken !== undefined ? it.fails : it)(row.name, run);
  }
});
