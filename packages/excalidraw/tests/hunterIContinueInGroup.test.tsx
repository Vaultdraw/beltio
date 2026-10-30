import { afterEach, describe, expect, it } from "vitest";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { getTextEditor } from "./queries/dom";
import { act, render, unmountComponent } from "./test-utils";

import type { TextEditorExtension, TextEditorSession } from "../types";

/**
 * Hunter I-8 (2026-10-30). Markdown mode's Enter after a heading (and the split of a later
 * line into its own box) goes through the session's `continueInNewText`, which builds the new
 * box from the old one's style but not its `groupIds` (nor its angle). A heading inside a group
 * (a card: rectangle + heading + body) gets its next paragraph OUTSIDE the group: moving or
 * copying the card leaves the new paragraph behind. The same call does copy the frame
 * (`frameId`), so the paragraph stays in the heading's frame but not in its group.
 */
unmountComponent();

describe("hunter I-8: the box Enter makes after a grouped heading", () => {
  afterEach(() => unmountComponent());

  it("keeps the heading's group", async () => {
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
      groupIds: ["card"],
    });
    const rect = API.createElement({
      type: "rectangle",
      x: -20,
      y: -20,
      width: 300,
      height: 200,
      groupIds: ["card"],
    });
    API.setElements([rect, heading]);
    act(() => {
      window.h.app.text.startTextEditing({
        sceneX: 0,
        sceneY: 0,
        insertAtParentCenter: false,
        textElement: heading as never,
      });
    });
    await getTextEditor();
    expect(session).not.toBeNull();
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
    );
    expect(body).toBeDefined();
    expect(body!.groupIds).toEqual(["card"]);
  });
});
