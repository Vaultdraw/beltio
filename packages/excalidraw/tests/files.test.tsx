import React from "react";
import { vi } from "vitest";

import { pruneImageCache } from "@excalidraw/element";

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

  it("redraws once decoded when an element using the file lands while it decodes (formula insert)", async () => {
    const triggerUpdate = vi.spyOn(h.app.scene, "triggerUpdate");
    const preload = h.app.addFiles([file("late")]);
    // insertFormula: addFiles, then the element, before the image decodes
    API.setElements([
      API.createElement({ type: "image", fileId: "late" as any }),
    ]);
    triggerUpdate.mockClear();
    await preload;
    expect(h.app.imageCache.get("late" as any)?.image).toBeInstanceOf(
      window.Image,
    );
    expect(triggerUpdate).toHaveBeenCalledTimes(1);
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
