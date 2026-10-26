import { Excalidraw } from "../index";

import { act, render } from "./test-utils";

const { h } = window;

const mermaidItem = () =>
  h.app.api.getCommandPaletteItems().find((item) => item.id === "mermaid");

describe("UIOptions.tools.mermaid", () => {
  it("offers Mermaid to Excalidraw by default", async () => {
    const { container } = await render(
      <Excalidraw handleKeyboardGlobally={true} />,
    );
    expect(mermaidItem()?.available).toBe(true);
    act(() => h.app.setOpenDialog({ name: "ttd", tab: "mermaid" }));
    expect(container.ownerDocument.querySelector(".ttd-dialog")).not.toBeNull();
  });

  it("false hides the palette item and never shows the dialog", async () => {
    const { container } = await render(
      <Excalidraw
        handleKeyboardGlobally={true}
        UIOptions={{ tools: { image: true, mermaid: false } }}
      />,
    );
    expect(mermaidItem()?.available ?? false).toBe(false);
    act(() => h.app.setOpenDialog({ name: "ttd", tab: "mermaid" }));
    expect(container.ownerDocument.querySelector(".ttd-dialog")).toBeNull();
  });
});
