import { Excalidraw } from "@excalidraw/excalidraw";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { applyOps } from "./apply";
import { projectScene } from "./project";

const undo = () =>
  fireEvent.keyDown(document, { key: "z", code: "KeyZ", ctrlKey: true });
const redo = () =>
  fireEvent.keyDown(document, {
    key: "z",
    code: "KeyZ",
    ctrlKey: true,
    shiftKey: true,
  });

describe("applyOps in the real editor", () => {
  it("is one undo step and one redo step", async () => {
    let api!: ExcalidrawImperativeAPI;
    render(
      <div style={{ width: 800, height: 600 }}>
        <Excalidraw
          handleKeyboardGlobally
          onExcalidrawAPI={(a) => {
            if (a) {
              api = a;
            }
          }}
        />
      </div>,
    );
    await waitFor(() => expect(api).toBeTruthy());
    const live = () => projectScene(api.getSceneElements());

    // A first batch so there is something to update.
    let first!: string[];
    act(() => {
      first = applyOps(api, [
        {
          op: "add",
          element: { type: "rectangle", x: 0, y: 0, width: 50, height: 50 },
        },
      ]).ids;
    });
    expect(live()).toHaveLength(1);

    act(() => {
      applyOps(api, [
        { op: "add", element: { type: "rectangle", width: 10, height: 10 } },
        { op: "add", element: { type: "ellipse", width: 10, height: 10 } },
        { op: "add", element: { type: "text", text: "hi" } },
        { op: "update", id: first[0], props: { x: 200 } },
      ]);
    });
    expect(live()).toHaveLength(4);
    expect(live().find((e) => e.id === first[0])?.x).toBe(200);

    act(() => undo());
    expect(live()).toHaveLength(1);
    expect(live()[0].x).toBe(0);

    act(() => redo());
    expect(live()).toHaveLength(4);
    expect(live().find((e) => e.id === first[0])?.x).toBe(200);
  });
});
