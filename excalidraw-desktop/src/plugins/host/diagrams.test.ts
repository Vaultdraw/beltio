import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDiagramsApi } from "./diagramsContext";

const parse = vi.fn();
vi.mock("@excalidraw/mermaid-to-excalidraw", () => ({
  parseMermaidToExcalidraw: (t: string) => parse(t),
}));

let mermaidOn = true;
vi.mock("../../extensionSwitches/useExtensions", () => ({
  getExtensions: () => ({ mermaid: mermaidOn }),
}));

beforeEach(() => {
  mermaidOn = true;
  parse.mockReset();
});

describe("ctx.diagrams.mermaidToElements", () => {
  it("converts with the editor's converter and answers as scene ops", async () => {
    parse.mockResolvedValue({
      elements: [
        { id: "A", type: "rectangle", x: 10, y: 10, width: 5, height: 5 },
      ],
    });
    const r = await createDiagramsApi().mermaidToElements("graph TD; A");
    expect(parse).toHaveBeenCalledWith("graph TD; A");
    expect(r.ops).toHaveLength(1);
    expect(r.width).toBe(5);
  });

  it("refuses empty text, and loads nothing while Mermaid is off", async () => {
    await expect(createDiagramsApi().mermaidToElements("")).rejects.toThrow(
      /needs the Mermaid text/,
    );
    mermaidOn = false;
    await expect(
      createDiagramsApi().mermaidToElements("graph TD"),
    ).rejects.toThrow(/turned off/);
    expect(parse).not.toHaveBeenCalled();
  });

  it("passes the converter's message on for text it cannot read", async () => {
    parse.mockRejectedValue(new Error("Parse error on line 1"));
    await expect(
      createDiagramsApi().mermaidToElements("nonsense"),
    ).rejects.toThrow(/Parse error/);
  });
});
