import { Excalidraw } from "@excalidraw/excalidraw";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { projectScene } from "../sceneOps";

import { createSceneMethods } from "./sceneMethods";

const undo = () =>
  fireEvent.keyDown(document, { key: "z", code: "KeyZ", ctrlKey: true });

describe("scene.apply in the real editor", () => {
  it("one call is one undo step, and the version moves with the scene", async () => {
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
    const notify = vi.fn();
    const m = createSceneMethods({
      active: () => ({ api, path: "a.excalidraw", readOnly: false }),
      notify,
    });
    const live = () => projectScene(api.getSceneElements());
    const v0 = (m["scene.read"]({}) as any).version;

    let r!: any;
    act(() => {
      r = m["scene.apply"]({
        ifVersion: v0,
        ops: [
          { op: "add", element: { type: "rectangle", width: 10, height: 10 } },
          { op: "add", element: { type: "ellipse", width: 10, height: 10 } },
          { op: "add", element: { type: "text", text: "hi" } },
        ],
      });
    });
    expect(live()).toHaveLength(3);
    expect(r.ids).toHaveLength(3);
    expect(r.version).not.toBe(v0);
    expect((m["scene.read"]({}) as any).version).toBe(r.version);
    expect(notify).toHaveBeenCalledTimes(1);

    act(() => undo());
    expect(live()).toHaveLength(0);
  });
});
