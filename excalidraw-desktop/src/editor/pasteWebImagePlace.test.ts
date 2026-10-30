import { describe, expect, it, vi } from "vitest";

/**
 * Hunter B round 2 (parity): a pasted web picture is centred on the viewport like the editor's
 * own picture paste (Obsidian canvas too), not hung from the centre by its top edge. Pictures
 * that cannot be downloaded stack as labelled boxes; the whole stack is centred.
 */
const applied: { element: { type: string; y: number; height: number } }[][] =
  [];

vi.mock("../network/webImage", () => ({
  fetchWebImage: async (url: string) => {
    if (url.includes("broken")) {
      throw Object.assign(new Error("nope"), { code: "IO_ERROR" });
    }
    return new Uint8Array([1]);
  },
}));
vi.mock("../../../sdk/api/shared/sceneRules", async (orig) => ({
  ...(await orig<object>()),
  pictureType: () => "image/png",
}));
vi.mock("../sceneOps", () => ({
  viewportCenter: () => ({ x: 500, y: 400 }),
  hashImages: async () => ({}),
  applyOps: (_api: unknown, ops: never[]) => {
    applied.push(ops);
  },
}));

const { pasteWebPictures } = await import("./pasteWebImage");

const api = { getAppState: () => ({}) } as never;
// createImageBitmap is missing in jsdom: sizeOf falls back to 320 x 240.

const span = (ops: typeof applied[number]) => {
  const top = Math.min(...ops.map((o) => o.element.y));
  const bottom = Math.max(
    ...ops.map((o) => o.element.y + (o.element.height ?? 0)),
  );
  return (top + bottom) / 2;
};

describe("a pasted web picture lands centred on the viewport", () => {
  it.each([
    ["one picture", { text: "https://a.example/p.png" }],
    [
      "a page part with two pictures and one broken",
      {
        text: "x",
        mixedContent: [
          { type: "imageUrl", value: "https://a.example/1.png" },
          { type: "imageUrl", value: "https://a.example/broken.png" },
          { type: "imageUrl", value: "https://a.example/2.png" },
        ],
      },
    ],
  ])("%s", async (_, data) => {
    applied.length = 0;
    expect(await pasteWebPictures(api, data)).toBe(true);
    const boxes = applied[0].filter((o) => o.element.type !== "text");
    expect(span(boxes)).toBeCloseTo(400, 0);
  });
});

describe("a pasted part of a web page keeps its words (hunter A-10)", () => {
  it("words and pictures land in page order", async () => {
    applied.length = 0;
    await pasteWebPictures(api, {
      text: "Intro\nAfter",
      mixedContent: [
        { type: "text", value: "Intro" },
        { type: "imageUrl", value: "https://a.example/1.png" },
        { type: "text", value: "  " },
        { type: "text", value: "After" },
      ],
    });
    const kinds = applied[0].map((o) =>
      o.element.type === "text"
        ? `text:${(o.element as unknown as { text: string }).text}`
        : o.element.type,
    );
    expect(kinds).toEqual(["text:Intro", "image", "text:After"]);
  });
});
