import React from "react";

import { Excalidraw } from "../index";

import { act, render } from "./test-utils";

const { h } = window;

// The constructor runs before the container exists, so the toolbar mode
// (full / compact) must be measured on mount. Before the fix, the first
// unrelated render after mount (often the user's first tool click) swapped
// the toolbar buttons under the pointer and the click was lost.
describe("toolbar mode on mount", () => {
  it("renders the compact toolbar at once and keeps its buttons on the next render", async () => {
    const { container } = await render(
      <Excalidraw UIOptions={{ getFormFactor: () => "tablet" }} />,
    );
    expect(h.app.editorInterface.formFactor).toBe("tablet");
    expect(container.querySelector(".App-toolbar--compact")).not.toBeNull();

    const freedraw = container.querySelector(
      '[data-testid="toolbar-freedraw"]',
    )!;
    act(() => h.setState({}));
    expect(freedraw.isConnected).toBe(true);
  });
});
