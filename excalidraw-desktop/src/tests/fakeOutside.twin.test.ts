import { describe, expect, it } from "vitest";

import { FakeVaultRepository } from "./fakeVaultRepository";
import { FakeVaultSearch } from "./fakeVaultSearch";

/**
 * Twin parity (bug utilizer, 2026-10-30, hunter C): the browser fake must act like the native
 * watcher and index, or Playwright cannot test what users see after outside changes.
 * - auto reload off (`setWatching(false)`): changes made outside send no event; on again, they do.
 * - an outside edit of a file's contents ("modify") changes what is read and reports the path.
 * - every vault change is followed by a search index status event (tags pane, backlinks dock).
 */
const EMPTY = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "t",
  elements: [],
  appState: {},
  files: {},
});

const setup = async () => {
  const repo = new FakeVaultRepository();
  repo.seedDrawing("A.excalidraw", EMPTY);
  const events: string[][] = [];
  await repo.subscribe((e) => events.push(e.paths));
  return { repo, events };
};

describe("fake vault: outside changes like the native watcher", () => {
  it.each([
    ["create", { op: "create" as const, path: "B.excalidraw" }],
    ["delete", { op: "delete" as const, path: "A.excalidraw" }],
    [
      "rename",
      { op: "rename" as const, path: "A.excalidraw", to: "C.excalidraw" },
    ],
    ["modify", { op: "modify" as const, path: "A.excalidraw", content: EMPTY }],
  ])(
    "%s: an event with the watcher on, none with it off",
    async (_, change) => {
      const on = await setup();
      on.repo.outside(change);
      expect(on.events.length).toBe(1);
      const off = await setup();
      await off.repo.setWatching(off.repo.handle, false);
      off.repo.outside(change);
      expect(off.events).toEqual([]);
    },
  );

  it("externalWrite and externalDelete follow the watcher too", async () => {
    const { repo, events } = await setup();
    await repo.setWatching(repo.handle, false);
    repo.externalWrite("A.excalidraw", EMPTY);
    repo.externalDelete("A.excalidraw");
    expect(events).toEqual([]);
  });

  it("modify changes what is read, with a new revision", async () => {
    const { repo } = await setup();
    const before = await repo.readDrawing(repo.handle, "A.excalidraw");
    const json = EMPTY.replace('"t"', '"outside"');
    repo.outside({ op: "modify", path: "A.excalidraw", content: json });
    const after = await repo.readDrawing(repo.handle, "A.excalidraw");
    expect(after.json).toBe(json);
    expect(after.revision).not.toBe(before.revision);
  });

  it("the index reports a status after each vault change", async () => {
    const { repo } = await setup();
    const search = new FakeVaultSearch(repo);
    let statuses = 0;
    await search.subscribe(() => statuses++);
    repo.outside({ op: "modify", path: "A.excalidraw", content: EMPTY });
    await new Promise((r) => setTimeout(r, 10));
    expect(statuses).toBeGreaterThan(0);
  });
});
