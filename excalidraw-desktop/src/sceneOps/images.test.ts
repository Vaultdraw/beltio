import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { BinaryFiles } from "@excalidraw/excalidraw/types";

import {
  DRAWING_BYTES_HEADROOM,
  IMAGE_MIMES,
  MAX_DRAWING_BYTES,
  MAX_IMAGE_BYTES,
} from "../../../sdk/api/shared/sceneRules";
import {
  DRAWING_BYTES_HEADROOM as PDF_HEADROOM,
  MAX_DRAWING_BYTES as PDF_MAX,
} from "../../../plugins/official/pdf-import/src/limits";

import { applyOps } from "./apply";
import { hashImages, toBase64 } from "./images";
import { makeElements, stubApi } from "./testUtils";

import { validateOps } from "./validate";

import type { SceneOpsError } from "./types";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);
const png = (bytes = PNG) => ({ mime: "image/png" as const, bytes });
const image = (over: Record<string, unknown> = {}) => ({
  op: "add" as const,
  element: {
    type: "image" as const,
    width: 40,
    height: 30,
    image: png(),
    ...over,
  },
});
const sha1 = (b: Uint8Array) => createHash("sha1").update(b).digest("hex");

const issues = (ops: unknown) => {
  try {
    validateOps(ops, new Map(), { allowImages: true });
    return [];
  } catch (err) {
    return (err as SceneOpsError).issues;
  }
};

describe("image validation", () => {
  it("accepts a well-formed image", () => {
    expect(issues([image()])).toEqual([]);
  });

  it.each([
    ["no image", { image: undefined }, "image"],
    ["bad mime", { image: { mime: "image/bmp", bytes: PNG } }, "image"],
    ["empty bytes", { image: png(new Uint8Array()) }, "image"],
    [
      "bytes that are not an image",
      { image: png(new Uint8Array(20)) },
      "image",
    ],
    [
      "bytes as a plain array",
      { image: { mime: "image/png", bytes: [1] } },
      "image",
    ],
    ["no width", { width: undefined }, "width"],
    ["no height", { height: undefined }, "height"],
    ["text", { text: "x" }, "text"],
    ["points", { points: [[0, 0]] }, "points"],
  ])("refuses an image with %s", (_n, over, key) => {
    const el = { ...image().element, ...over } as Record<string, unknown>;
    for (const k of Object.keys(el)) {
      if (el[k] === undefined) {
        delete el[k];
      }
    }
    expect(issues([{ op: "add", element: el }]).map((i) => i.key)).toContain(
      key,
    );
  });

  it("refuses a picture above the per-image limit", () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG);
    expect(issues([image({ image: png(big) })])[0].message).toMatch(
      /larger than/,
    );
  });

  it("checks every allowed type's signature", () => {
    const samples: Record<string, number[]> = {
      "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      "image/jpeg": [0xff, 0xd8, 0xff, 0xe0],
      "image/gif": [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
      "image/webp": [
        0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      ],
      "image/svg+xml": [...new TextEncoder().encode('<svg xmlns="x"/>')],
    };
    for (const mime of IMAGE_MIMES) {
      const bytes = new Uint8Array(samples[mime]);
      expect(issues([image({ image: { mime, bytes } })])).toEqual([]);
    }
  });

  it("allows image only on image elements, and in an update only where images are allowed", () => {
    expect(
      issues([{ op: "add", element: { type: "rectangle", image: png() } }])[0]
        .message,
    ).toMatch(/only valid when adding/);
    const existing = new Map([
      ["a", { type: "image" }],
      ["r", { type: "rectangle" }],
    ]);
    const upd = (id: string, allowImages: boolean, props = { image: png() }) =>
      validateOps([{ op: "update", id, props }], existing, { allowImages });
    expect(() => upd("a", true)).not.toThrow();
    expect(() => upd("r", true)).toThrow(/only valid on image elements/);
    expect(() => upd("a", false)).toThrow(/images are not available/);
    expect(() =>
      upd("a", true, { image: { mime: "image/bmp", bytes: PNG } } as never),
    ).toThrow(/image/);
  });

  it("refuses an arrow bound to an image", () => {
    const ops = [
      { ...image(), ref: "pic" },
      { op: "add", element: { type: "arrow", start: { ref: "pic" } } },
    ];
    expect(issues(ops)[0].message).toMatch(/binds only to/);
  });
});

describe("where images are not allowed", () => {
  it("validateOps refuses them by default (createDrawing, control API)", () => {
    expect(() => validateOps([image()], new Map())).toThrow(
      /not available here/,
    );
  });

  it("applyOps refuses them when the caller did not hash (control API)", () => {
    const { api, updateScene } = stubApi();
    expect(() => applyOps(api, [image()])).toThrow(/not available here/);
    expect(updateScene).not.toHaveBeenCalled();
  });
});

describe("hashImages", () => {
  it("is the SHA-1 of the bytes, as the editor names files", async () => {
    const op = image();
    const hashes = await hashImages([op]);
    expect(hashes.get(op)).toBe(sha1(PNG));
  });

  it("gives equal bytes the same id and skips what cannot pass", async () => {
    const a = image();
    const b = image({ image: png(new Uint8Array(PNG)) });
    const bad = image({ image: { mime: "image/png", bytes: [1] } });
    const rect = { op: "add", element: { type: "rectangle" } };
    const hashes = await hashImages([a, b, bad, rect, null, 7]);
    expect(hashes.get(a)).toBe(hashes.get(b));
    expect(hashes.size).toBe(2);
    expect((await hashImages("nope")).size).toBe(0);
  });

  it("hashes nothing above the ops limit", async () => {
    expect((await hashImages([image(), image()], 1)).size).toBe(0);
  });
});

describe("toBase64", () => {
  it("matches Buffer for a large input (no stack overflow)", () => {
    const big = new Uint8Array(1_000_003).map((_, i) => i % 251);
    expect(toBase64(big)).toBe(Buffer.from(big).toString("base64"));
  });
});

describe("applyOps: image update in place", () => {
  const PNG2 = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9,
  ]);
  it("swaps the picture and keeps id, z-order, groups, bindings, frame, angle and lock", async () => {
    const [a, b, c] = makeElements(3);
    const pic = {
      ...b,
      type: "image",
      fileId: "old",
      status: "saved",
      groupIds: ["g1"],
      boundElements: [{ id: "arrow1", type: "arrow" }],
      frameId: "f1",
      angle: 0.5,
      locked: true,
    } as never as typeof b;
    const { api, updateScene, addFiles } = stubApi([a, pic, c]);
    const op = {
      op: "update" as const,
      id: pic.id,
      props: { image: png(PNG2), width: 77 },
    };
    const images = await hashImages([op]);
    const { ids } = applyOps(api, [op], { images });
    expect(ids).toEqual([]);
    expect(addFiles.mock.calls[0][0][0]).toMatchObject({ id: sha1(PNG2) });
    expect(updateScene).toHaveBeenCalledTimes(1);
    const els = updateScene.mock.calls[0][0].elements;
    expect(els.map((e: { id: string }) => e.id)).toEqual([a.id, b.id, c.id]);
    expect(els[1]).toMatchObject({
      id: pic.id,
      fileId: sha1(PNG2),
      status: "saved",
      width: 77,
      groupIds: ["g1"],
      boundElements: [{ id: "arrow1", type: "arrow" }],
      frameId: "f1",
      angle: 0.5,
      locked: true,
    });
  });

  it("refuses an update whose picture was not hashed, writing nothing", () => {
    const [a] = makeElements(1);
    const { api, updateScene } = stubApi([{ ...a, type: "image" } as never]);
    expect(() =>
      applyOps(api, [{ op: "update", id: a.id, props: { image: png() } }], {
        images: new Map(),
      }),
    ).toThrow(/hashed/);
    expect(updateScene).not.toHaveBeenCalled();
  });
});

describe("applyOps with images", () => {
  it("adds the file, then the element, in one scene update", async () => {
    const { api, updateScene, addFiles, order } = stubApi();
    const op = image({ x: 5, y: 6 });
    const images = await hashImages([op]);
    const { ids } = applyOps(api, [op], { images });
    expect(order).toEqual(["addFiles", "updateScene"]);
    expect(updateScene).toHaveBeenCalledTimes(1);
    const file = addFiles.mock.calls[0][0][0];
    expect(file).toMatchObject({ id: sha1(PNG), mimeType: "image/png" });
    expect(file.dataURL).toBe(
      `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`,
    );
    const el = updateScene.mock.calls[0][0].elements.find(
      (e: { id: string }) => e.id === ids[0],
    );
    expect(el).toMatchObject({
      type: "image",
      fileId: sha1(PNG),
      status: "saved",
      x: 5,
      y: 6,
      width: 40,
      height: 30,
    });
  });

  it("stores a picture once: repeated in a batch, or already in the drawing", async () => {
    const { api, addFiles } = stubApi();
    const ops = [image(), image()];
    applyOps(api, ops, { images: await hashImages(ops) });
    expect(addFiles.mock.calls[0][0]).toHaveLength(1);

    const again = [image({ x: 1, y: 1 })];
    applyOps(api, again, { images: await hashImages(again) });
    expect(addFiles).toHaveBeenCalledTimes(1); // nothing new to store
  });

  it("centres an image without x and y on the viewport", async () => {
    const { api, updateScene } = stubApi();
    const op = image();
    applyOps(api, [op], { images: await hashImages([op]) });
    const el = updateScene.mock.calls[0][0].elements[0];
    expect(el.x + el.width / 2).toBeCloseTo(500);
    expect(el.y + el.height / 2).toBeCloseTo(300);
  });

  it("refuses an image the hashing step did not see, writing nothing", () => {
    const { api, updateScene, addFiles } = stubApi();
    expect(() => applyOps(api, [image()], { images: new Map() })).toThrow(
      /hashed/,
    );
    expect(updateScene).not.toHaveBeenCalled();
    expect(addFiles).not.toHaveBeenCalled();
  });

  it("refuses with TOO_LARGE when the drawing would pass its cap, writing nothing", async () => {
    const used = Math.floor(DRAWING_BYTES_HEADROOM * MAX_DRAWING_BYTES) - 100;
    const files = {
      old: { id: "old", mimeType: "image/png", dataURL: "x".repeat(used) },
    } as unknown as BinaryFiles;
    const { api, updateScene, addFiles } = stubApi(makeElements(1), {}, files);
    const op = image();
    const images = await hashImages([op]);
    let err: { code?: string; message?: string } = {};
    try {
      applyOps(api, [op], { images });
    } catch (e) {
      err = e as { code?: string; message?: string };
    }
    expect(err.code).toBe("TOO_LARGE");
    expect(err.message).toMatch(/MiB/);
    expect(updateScene).not.toHaveBeenCalled();
    expect(addFiles).not.toHaveBeenCalled();
  });

  it("lets a batch pass that fits just under the cap, and counts a known picture once", async () => {
    const used = Math.floor(DRAWING_BYTES_HEADROOM * MAX_DRAWING_BYTES) - 2000;
    const files = {
      [sha1(PNG)]: {
        id: sha1(PNG),
        mimeType: "image/png",
        dataURL: "x".repeat(used),
      },
    } as unknown as BinaryFiles;
    const { api, updateScene } = stubApi([], {}, files);
    const ops = [image(), image()];
    applyOps(api, ops, { images: await hashImages(ops) });
    expect(updateScene).toHaveBeenCalledTimes(1);
  });

  it("changes nothing for a batch without images (no file calls)", () => {
    const { api, addFiles } = stubApi();
    applyOps(api, [{ op: "add", element: { type: "rectangle" } }]);
    expect(addFiles).not.toHaveBeenCalled();
  });
});

describe("limits", () => {
  it("mirror the native cap and the pdf import", () => {
    expect(MAX_DRAWING_BYTES).toBe(PDF_MAX);
    expect(DRAWING_BYTES_HEADROOM).toBe(PDF_HEADROOM);
  });
});
