/** Timing of a 2,000-item library (wall-clock, so outside the fast tier). */
import { newElement } from "@excalidraw/element";
import { serializeLibraryAsJSON } from "@excalidraw/excalidraw";

import type { LibraryItem } from "@excalidraw/excalidraw/types";

import { LibraryStore } from "../library/libraryStore";

import { FakeLibraryRepository } from "./fakeLibraryRepository";

const item = (id: string, x = 0): LibraryItem => ({
  id,
  status: "unpublished",
  created: 1,
  elements: [
    newElement({ type: "rectangle", x, y: 0, width: 10, height: 10 }) as any,
  ],
});

describe("LibraryStore speed (2,000 items)", () => {
  it("loads and flushes within 10 s", async () => {
    const repo = new FakeLibraryRepository();
    repo.setFile(
      "personal",
      serializeLibraryAsJSON(
        Array.from({ length: 2000 }, (_, i) => item(`i${i}`, i)),
      ),
    );
    const store = new LibraryStore(repo, { scheduleIdle: (run) => run() });
    const t0 = performance.now();
    const loaded = (await store.adapter.load({ source: "load" }))!
      .libraryItems as LibraryItem[];
    const loadMs = performance.now() - t0;
    store.adapter.save({
      libraryItems: [item("new"), ...loaded.slice(0, 1990)],
    });
    const t1 = performance.now();
    await store.flush();
    const flushMs = performance.now() - t1;
    // eslint-disable-next-line no-console
    console.log(
      `LIB2000 load=${loadMs.toFixed(0)}ms flush=${flushMs.toFixed(0)}ms`,
    );
    expect(loadMs).toBeLessThan(10_000);
    expect(flushMs).toBeLessThan(10_000);
    store.dispose();
  });
});
