import { afterEach, describe, expect, it, vi } from "vitest";

import { ControlError } from "../control/errors";
import { SAMPLE_SCENE } from "../tests/fixtures";

import {
  findExportFrame,
  renderExport,
  sceneToExportRequest,
} from "./renderExport";

const renderImageExport = vi.fn();
vi.mock("../editor/imageExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../editor/imageExport")>()),
  renderImageExport: (...args: unknown[]) => renderImageExport(...args),
}));

afterEach(() => vi.clearAllMocks());

const win = window as unknown as Window & typeof globalThis;
const options = {
  scale: 1,
  background: true,
  embedScene: false,
  pattern: true,
  dark: false,
};

/** SAMPLE_SCENE plus a frame named "Slide 1" (id "frame-1"). */
const framedScene = () => {
  const scene = JSON.parse(SAMPLE_SCENE);
  scene.elements.push({
    ...scene.elements[0],
    id: "frame-1",
    type: "frame",
    name: "Slide 1",
    x: 0,
    y: 0,
    width: 300,
    height: 200,
  });
  return JSON.stringify(scene);
};

// Minimal element shapes: findExportFrame only reads type, id, name and isDeleted.
const el = (over: Record<string, unknown>) =>
  ({ x: 0, y: 0, width: 10, height: 10, isDeleted: false, ...over } as any);

const elements = [
  el({ id: "rect", type: "rectangle", name: "Slide 1" }),
  el({ id: "f1", type: "frame", name: "Slide 1" }),
  el({ id: "f2", type: "frame", name: "Overview" }),
  el({ id: "m1", type: "magicframe", name: "Magic" }),
  el({ id: "gone", type: "frame", name: "Ghost", isDeleted: true }),
  el({ id: "Overview", type: "frame", name: "By id wins" }),
];

describe("findExportFrame", () => {
  it("finds a frame by id", () => {
    expect(findExportFrame(elements, "f2").id).toBe("f2");
  });

  it("finds a frame by name, first match in element order", () => {
    expect(findExportFrame(elements, "Slide 1").id).toBe("f1");
    expect(findExportFrame(elements, "Magic").id).toBe("m1");
  });

  it("prefers an id match over a name match", () => {
    expect(findExportFrame(elements, "Overview").id).toBe("Overview");
  });

  it("matches names case-sensitively and ignores non-frame elements", () => {
    expect(() => findExportFrame(elements, "slide 1")).toThrow(ControlError);
    expect(() => findExportFrame(elements, "rect")).toThrow(ControlError);
  });

  it("ignores deleted frames", () => {
    expect(() => findExportFrame(elements, "Ghost")).toThrow(ControlError);
    expect(() => findExportFrame(elements, "gone")).toThrow(ControlError);
  });

  it("reports NOT_FOUND with the frame in data", () => {
    try {
      findExportFrame(elements, "Nope");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ControlError);
      expect((e as ControlError).code).toBe("NOT_FOUND");
      expect((e as ControlError).data).toEqual({ frame: "Nope" });
    }
  });
});

describe("sceneToExportRequest with a frame", () => {
  it("crops to the frame named in the options, by id or by name", async () => {
    for (const frame of ["frame-1", "Slide 1"]) {
      const request = await sceneToExportRequest(
        framedScene(),
        "F.excalidraw",
        "png",
        { ...options, frame },
        win,
      );
      expect(request.exportingFrame?.id).toBe("frame-1");
    }
  });

  it("rejects an unknown frame with NOT_FOUND", async () => {
    await expect(
      sceneToExportRequest(
        framedScene(),
        "F.excalidraw",
        "svg",
        { ...options, frame: "Nope" },
        win,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", data: { frame: "Nope" } });
  });
});

describe("renderExport padding", () => {
  it("hands the padding to the renderer, not the request's appState", async () => {
    renderImageExport.mockResolvedValue({ bytes: new Uint8Array([1]) });
    await renderExport(
      SAMPLE_SCENE,
      "A.excalidraw",
      "svg",
      { ...options, padding: 0 },
      win,
    );
    expect(renderImageExport.mock.calls[0][2]).toEqual({ padding: 0 });
    expect(renderImageExport.mock.calls[0][0].appState).not.toHaveProperty(
      "exportPadding",
    );
  });
});
