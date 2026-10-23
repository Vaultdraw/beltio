import React from "react";
import { vi } from "vitest";

import { pruneImageCache, ShapeCache } from "@excalidraw/element";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";

import { render, unmountComponent } from "./test-utils";

import type { BinaryFileData } from "../types";

unmountComponent();

const h = window.h;

const file = (id: string, ok = true): BinaryFileData =>
  ({
    id,
    mimeType: "image/png",
    dataURL: ok ? `data:image/png;base64,${id}` : "data:image/png;base64,BAD",
    created: 1,
  } as unknown as BinaryFileData);

/** jsdom never decodes images: fire load/error right after `src` is set. */
const stubImage = () => {
  const Original = window.Image;
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    set src(value: string) {
      setTimeout(() =>
        value.includes("BAD")
          ? this.onerror?.(new Error("bad"))
          : this.onload?.(),
      );
    }
  }
  window.Image = FakeImage as unknown as typeof Image;
  return () => {
    window.Image = Original;
  };
};

/**
 * Holds every decode until `release()`. Replaces window.Image; the
 * suite's afterEach puts the real one back even when a test fails.
 */
const holdDecodes = () => {
  const held: (() => void)[] = [];
  let built = 0;
  // A canvas stands in for the decoded image: the renderer can draw it.
  function HeldImage() {
    built++;
    const img = document.createElement("canvas") as any;
    Object.defineProperty(img, "src", {
      set: (value: string) =>
        held.push(() =>
          value.includes("BAD")
            ? img.onerror?.(new Error("bad"))
            : img.onload?.(),
        ),
    });
    return img;
  }
  window.Image = HeldImage as unknown as typeof Image;
  return {
    built: () => built,
    release: () => held.splice(0).forEach((fire) => fire()),
  };
};

const image = (fileId: string) =>
  API.createElement({ type: "image", fileId: fileId as any });

/** Caches the element's shape as a render does (null for images). */
const cacheShape = (element: ReturnType<typeof image>) => {
  ShapeCache.generateElementShape(element as any, null);
  expect(ShapeCache.get(element, null)).not.toBeUndefined();
};

const settle = () => new Promise((r) => setTimeout(r, 30));

describe("addFiles / retainFiles", () => {
  let restore: () => void;
  beforeEach(async () => {
    restore = stubImage();
    await render(<Excalidraw />);
  });
  afterEach(() => restore());

  it("resolves once the images are in the image cache, with no element using them", async () => {
    const promise = h.app.addFiles([file("a"), file("b")]);
    expect(promise).toBeInstanceOf(Promise);
    await promise;
    for (const id of ["a", "b"]) {
      expect(h.app.imageCache.get(id as any)?.image).toBeInstanceOf(
        window.Image,
      );
    }
    expect(Object.keys(h.app.files).sort()).toEqual(["a", "b"]);
  });

  it("never rejects and leaves a failed image uncached so rendering can flag it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(h.app.addFiles([file("bad", false)])).resolves.toBeUndefined();
    expect(h.app.imageCache.has("bad" as any)).toBe(false);
    spy.mockRestore();
  });

  it("does not redraw the scene for files none of its elements use (a preload for the next scene)", async () => {
    const triggerUpdate = vi.spyOn(h.app.scene, "triggerUpdate");
    await h.app.addFiles([file("next1"), file("next2")]);
    expect(triggerUpdate).not.toHaveBeenCalled();
  });

  it("redraws when an image element of the scene uses an added file", async () => {
    const image = API.createElement({
      type: "image",
      fileId: "used" as any,
    });
    API.setElements([image]);
    const triggerUpdate = vi.spyOn(h.app.scene, "triggerUpdate");
    await h.app.addFiles([file("used")]);
    expect(triggerUpdate).toHaveBeenCalled();
  });

  it("an element that lands while its file decodes (formula insert: addFiles, then the element) drops its cached placeholder and redraws once", async () => {
    const decode = holdDecodes();
    const preload = h.app.addFiles([file("late")]);
    const el = image("late");
    API.setElements([el]);
    cacheShape(el); // drawn (and cached) as the placeholder
    const triggerUpdate = vi.spyOn(h.app.scene, "triggerUpdate");
    decode.release();
    await preload;
    expect(ShapeCache.get(el, null)).toBeUndefined();
    expect(triggerUpdate).toHaveBeenCalledTimes(1);
  });

  it("an element added while another route decodes its file (paste, duplicate, undo) drops its cached placeholder", async () => {
    const decode = holdDecodes();
    const first = image("pasted");
    API.setElements([first]);
    (h.app as any).addMissingFiles([file("pasted")]);
    const decoding = (h.app as any).addNewImagesToImageCache();
    const second = image("pasted"); // lands mid-decode
    API.setElements([first, second]);
    cacheShape(second);
    const triggerUpdate = vi.spyOn(h.app.scene, "triggerUpdate");
    decode.release();
    await decoding;
    expect(ShapeCache.get(second, null)).toBeUndefined();
    expect(triggerUpdate).toHaveBeenCalledTimes(1);
  });

  it("N images whose elements land while decoding: each built once, one batched redraw", async () => {
    const decode = holdDecodes();
    const ids = ["d1", "d2", "d3", "d4", "d5"];
    const preload = h.app.addFiles(ids.map((id) => file(id)));
    const els = ids.map(image);
    API.setElements(els);
    els.forEach(cacheShape);
    const triggerUpdate = vi.spyOn(h.app.scene, "triggerUpdate");
    decode.release();
    await preload;
    await settle();
    expect(decode.built()).toBe(5);
    expect(triggerUpdate).toHaveBeenCalledTimes(1);
    els.forEach((el) => expect(ShapeCache.get(el, null)).toBeUndefined());
  });

  it("an open whose files decode first builds each image once and adds no redraw", async () => {
    const decode = holdDecodes();
    const ids = ["o1", "o2", "o3"];
    const preload = h.app.addFiles(ids.map((id) => file(id)));
    decode.release();
    await preload;
    const triggerUpdate = vi.spyOn(h.app.scene, "triggerUpdate");
    API.setElements(ids.map(image));
    const afterSet = triggerUpdate.mock.calls.length;
    await settle();
    expect(decode.built()).toBe(3);
    expect(triggerUpdate.mock.calls.length).toBe(afterSet);
  });

  it("addFiles for elements already in the scene builds each image once and redraws once after the decode", async () => {
    const decode = holdDecodes();
    const ids = ["s1", "s2", "s3"];
    API.setElements(ids.map(image));
    const triggerUpdate = vi.spyOn(h.app.scene, "triggerUpdate");
    const preload = h.app.addFiles(ids.map((id) => file(id)));
    const beforeDecode = triggerUpdate.mock.calls.length; // addFiles' own sync redraw
    decode.release();
    await preload;
    await settle();
    expect(decode.built()).toBe(3);
    expect(triggerUpdate.mock.calls.length - beforeDecode).toBe(1);
  });

  it("an errored decode keeps its placeholder cached and adds no redraw", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const decode = holdDecodes();
    const preload = h.app.addFiles([file("bad", false)]);
    const el = image("bad");
    API.setElements([el]);
    cacheShape(el);
    const triggerUpdate = vi.spyOn(h.app.scene, "triggerUpdate");
    decode.release();
    await preload;
    await settle();
    expect(h.app.imageCache.has("bad" as any)).toBe(false);
    expect(ShapeCache.get(el, null)).not.toBeUndefined();
    expect(triggerUpdate).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a missing file (no cache entry, nothing decoding) adds no redraw", async () => {
    const el = image("missing");
    API.setElements([el]);
    cacheShape(el);
    const triggerUpdate = vi.spyOn(h.app.scene, "triggerUpdate");
    await settle();
    expect(ShapeCache.get(el, null)).not.toBeUndefined();
    expect(triggerUpdate).not.toHaveBeenCalled();
  });

  it("keeps existing files and does not decode them again", async () => {
    await h.app.addFiles([file("a")]);
    const first = h.app.imageCache.get("a" as any);
    await h.app.addFiles([file("a"), file("c")]);
    expect(h.app.imageCache.get("a" as any)).toBe(first);
    expect(Object.keys(h.app.files).sort()).toEqual(["a", "c"]);
  });

  it("retainFiles drops files and decoded images outside the set", async () => {
    await h.app.addFiles([file("a"), file("b"), file("c")]);
    h.app.retainFiles(["b"]);
    expect(Object.keys(h.app.files)).toEqual(["b"]);
    expect([...h.app.imageCache.keys()]).toEqual(["b"]);
    expect(Object.keys(h.app.api.getFiles())).toEqual(["b"]);
  });

  it("the idle prune does not evict preloaded images in the window before their elements land", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const since = (h.app as any).imageCacheUnreferencedSince as Map<
      string,
      number
    >;
    const prune = (now: number) =>
      pruneImageCache({
        cache: h.app.imageCache,
        elements: h.app.scene.getElementsIncludingDeleted(),
        unreferencedSince: since as any,
        now,
      });
    const preload = h.app.addFiles(ids.map((id) => file(id)));
    prune(0); // an idle prune during decoding puts them on probation at t=0
    await preload; // decoding done: the probation clock restarts
    expect(since.size).toBe(0);
    prune(2500); // would have evicted them on the old clock
    expect(h.app.imageCache.size).toBe(10);
  });

  it("swap landing frees the outgoing drawing's images at once; the new drawing's preloaded ones stay", async () => {
    const old = Array.from({ length: 9 }, (_, i) => `old${i}`);
    await h.app.addFiles(old.map((id) => file(id)));
    await h.app.addFiles([file("new0"), file("new1")]);
    h.app.retainFiles(["new0", "new1"]);
    expect([...h.app.imageCache.keys()].sort()).toEqual(["new0", "new1"]);
    expect(Object.keys(h.app.files).sort()).toEqual(["new0", "new1"]);
    expect((h.app as any).imageCacheUnreferencedSince.size).toBe(0);
  });

  it("retainFiles leaves the library alone", async () => {
    await h.app.library.updateLibrary({
      libraryItems: [
        {
          id: "item1",
          status: "unpublished",
          created: 1,
          elements: [API.createElement({ type: "rectangle" })] as any,
        },
      ],
      merge: false,
    });
    await h.app.addFiles([file("a")]);
    h.app.retainFiles([]);
    const items = await h.app.library.getLatestLibrary();
    expect(items.map((i) => i.id)).toEqual(["item1"]);
  });

  it("is exposed on the imperative API", async () => {
    expect(typeof h.app.api.retainFiles).toBe("function");
    h.app.api.retainFiles([]);
    expect(Object.keys(h.app.files)).toEqual([]);
  });
});

describe("releasing files nothing can bring back", () => {
  let restore: () => void;
  beforeEach(async () => {
    restore = stubImage();
    await render(<Excalidraw />);
  });
  afterEach(() => restore());

  const addImages = async (ids: string[]) => {
    await h.app.addFiles(ids.map((id) => file(id)));
    API.setElements(ids.map((id) => image(id)));
  };

  it("frees a deleted image's file once no undo entry touches it, and not before", async () => {
    await addImages(["a", "b"]);
    const deleted = h.elements[0];
    API.updateElement(deleted, { isDeleted: true });
    // an undo entry still names the deleted element: it can come back
    h.app.history.undoStack.push({
      elements: { added: {}, removed: {}, updated: { [deleted.id]: {} } },
    } as any);
    expect(h.app.releaseUnusedFiles({ graceMs: 0 }).released).toBe(0);
    expect(Object.keys(h.app.files).sort()).toEqual(["a", "b"]);

    h.app.history.clear(); // horizon passed
    const out = h.app.releaseUnusedFiles({ graceMs: 0 });
    expect(out.released).toBe(1);
    expect(out.bytes).toBe(file("a").dataURL.length);
    expect(Object.keys(h.app.files)).toEqual(["b"]);
    expect(h.app.imageCache.has("a" as any)).toBe(false);
    expect(h.app.imageCache.has("b" as any)).toBe(true);
  });

  it("tells the host through onChange with the smaller files map", async () => {
    await addImages(["a"]);
    API.updateElement(h.elements[0], { isDeleted: true });
    const seen: string[][] = [];
    const off = h.app.onChangeEmitter.on((_e, _s, files) => {
      seen.push(Object.keys(files));
    });
    h.app.releaseUnusedFiles({ graceMs: 0 });
    off();
    expect(seen).toEqual([[]]);
  });

  it("trims the undo horizon, which makes older deleted images unreachable", async () => {
    await addImages(["a"]);
    const e = h.elements[0];
    API.updateElement(e, { isDeleted: true });
    const entry = (id: string) =>
      ({
        elements: { added: {}, removed: {}, updated: { [id]: {} } },
      } as any);
    h.app.history.undoStack.push(entry(e.id), entry("x"), entry("y"));
    h.app.setFilesRetention({ undoSteps: 2 });
    expect(h.app.releaseUnusedFiles({ graceMs: 0 }).released).toBe(1);
    expect(h.app.history.undoStack.length).toBe(2);
  });

  it("is off until the host turns it on, and zero work for a drawing without images", async () => {
    await addImages(["a"]);
    API.updateElement(h.elements[0], { isDeleted: true });
    h.app.history.clear();
    vi.useFakeTimers();
    try {
      h.app.setFilesRetention({ undoSteps: 0 });
      vi.advanceTimersByTime(60_000);
      expect(Object.keys(h.app.files)).toEqual(["a"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
