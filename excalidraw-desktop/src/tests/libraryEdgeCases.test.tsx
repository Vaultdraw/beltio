/**
 * F10 QA edge cases for LibraryStore + useVaultLibrary: large libraries,
 * torn writes, bounded conflict loops, vault switches, read-only sources.
 */
import { renderHook } from "@testing-library/react";

import { newElement } from "@excalidraw/element";
import { serializeLibraryAsJSON } from "@excalidraw/excalidraw";

import type { LibraryItem } from "@excalidraw/excalidraw/types";

import { LibraryStore } from "../library/libraryStore";
import { useVaultLibrary } from "../library/useVaultLibrary";

import { FakeLibraryRepository } from "./fakeLibraryRepository";

const item = (id: string, x = 0): LibraryItem => ({
  id,
  status: "unpublished",
  created: 1,
  elements: [
    newElement({ type: "rectangle", x, y: 0, width: 10, height: 10 }) as any,
  ],
});
const many = (n: number, prefix = "i") =>
  Array.from({ length: n }, (_, i) => item(`${prefix}${i}`, i));
const json = (...ids: string[]) =>
  serializeLibraryAsJSON(ids.map((id) => item(id)));
const idsOf = (items: readonly LibraryItem[]) => items.map((i) => i.id);

describe("LibraryStore edge cases (large library, real timers)", () => {
  it("loads, saves and flushes 2,000 items with one write per burst", async () => {
    const repo = new FakeLibraryRepository();
    repo.setFile("personal", serializeLibraryAsJSON(many(2000)));
    const store = new LibraryStore(repo, { scheduleIdle: (run) => run() });

    const loaded = (await store.adapter.load({ source: "load" }))!
      .libraryItems as LibraryItem[];
    expect(loaded).toHaveLength(2000);

    // A burst of edits (5 saves), then a flush: exactly one write.
    for (let i = 0; i < 5; i++) {
      store.adapter.save({
        libraryItems: [item(`new${i}`), ...loaded.slice(0, 1990 + i)],
      });
    }
    await store.flush();
    expect(repo.writes).toHaveLength(1);
    expect(JSON.parse(repo.writes[0].json).libraryItems).toHaveLength(1995);
    store.dispose();
  });
});

describe("LibraryStore edge cases (fake timers)", () => {
  let repo: FakeLibraryRepository;
  let store: LibraryStore;

  beforeEach(() => {
    vi.useFakeTimers();
    repo = new FakeLibraryRepository();
    store = new LibraryStore(repo, { scheduleIdle: (run) => run() });
  });
  afterEach(() => {
    store.dispose();
    vi.useRealTimers();
  });
  const load = async () =>
    (await store.adapter.load({ source: "load" }))!
      .libraryItems as LibraryItem[];

  it("a debounced burst against a 2,000 item library writes once", async () => {
    repo.setFile("personal", serializeLibraryAsJSON(many(2000)));
    const items = await load();
    for (let i = 0; i < 10; i++) {
      store.adapter.save({ libraryItems: [item(`n${i}`), ...items] });
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(3000);
    expect(repo.writes).toHaveLength(1);
  });

  it("a persistently torn file is flagged after exactly one retry and never written", async () => {
    repo.setFile("personal", json("a"));
    await load();
    const before = repo.readLog.length;
    repo.files.set("personal", { json: '{"type":"excali', revision: 50 });
    repo.emit({ scope: "personal" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(repo.readLog.length - before).toBe(2); // read + one retry
    expect(store.getErrors()[0]).toMatch(/could not be read/);
    store.adapter.save({ libraryItems: [item("x")] });
    await vi.advanceTimersByTimeAsync(3000);
    await store.flush();
    expect(repo.writes).toHaveLength(0);
    // The user repairs the file: the error clears and edits resume.
    repo.setFile("personal", json("a", "b"));
    await vi.advanceTimersByTimeAsync(100);
    expect(store.getErrors()).toEqual([]);
  });

  it("a torn file on the very first load is flagged immediately (no retry)", async () => {
    repo.setFile("personal", "{");
    await load();
    expect(repo.readLog).toHaveLength(1);
    expect(store.getErrors()).toHaveLength(1);
  });

  it("the conflict loop is bounded when the file changes on every write", async () => {
    repo.setFile("personal", json("a"));
    const items = await load();
    let attempts = 0;
    const real = repo.writeLibrary.bind(repo);
    repo.writeLibrary = async (...args) => {
      attempts++;
      // Another writer wins every race.
      // (no watcher event: a silent writer, e.g. a network share)
      repo.files.set("personal", {
        json: json("a", `ext${attempts}`),
        revision: 1000 + attempts,
      });
      return real(...args);
    };
    store.adapter.save({ libraryItems: [item("mine"), ...items] });
    await vi.advanceTimersByTimeAsync(650); // first debounced write cycle
    expect(attempts).toBeLessThanOrEqual(4);
    expect(attempts).toBeGreaterThan(1);
    expect(store.getErrors().join()).toMatch(/keeps changing/);
    // Nothing is lost locally: the pending item is still in the union.
    expect(idsOf(store.union())).toContain("mine");
    const settled = attempts;
    await vi.advanceTimersByTimeAsync(10_000);
    // KNOWN BUG (see QA.md #1): reconcile() re-schedules a write on every
    // conflict retry, so after giving up the store keeps retrying forever.
    expect(attempts).toBe(settled); // no runaway retries afterwards
  });

  it("vault switch flushes the old vault's pending write to the OLD handle", async () => {
    repo.setFile("vault", json("a"), "A");
    await store.setVault("A");
    const items = await load();
    store.assign(["late"], "vault"); // the UI assigns before adding
    store.adapter.save({ libraryItems: [item("late"), ...items] });
    // not yet debounced: switch vaults right now
    await store.setVault("B");
    expect(repo.getJson("vault", "A")).toContain('"late"');
    expect(repo.getJson("vault", "B")).toBeNull();
    expect(repo.writes.every((w) => w.key === "vault:A")).toBe(true);
    // B's items are not polluted by A's.
    expect(idsOf(store.union())).not.toContain("late");
    store.adapter.save({ libraryItems: [item("inB")] });
    await vi.advanceTimersByTimeAsync(700);
    expect(repo.getJson("vault", "A")).not.toContain("inB");
  });

  it("personal read error: no writes to personal, vault still writes", async () => {
    repo.setFile("personal", "garbage");
    repo.setFile("vault", json("v"), "h");
    await store.setVault("h");
    const items = await load();
    expect(store.getErrors().join()).toMatch(/personal/i);
    store.adapter.save({ libraryItems: [item("pNew"), ...items] });
    store.assign(["pNew"], "personal"); // refused: personal is unwritable
    store.adapter.save({
      libraryItems: [item("v2"), ...items.filter((i) => i.id === "v")],
    });
    store.assign(["v2"], "vault");
    await vi.advanceTimersByTimeAsync(3000);
    await store.flush();
    expect(repo.writes.some((w) => w.key === "personal")).toBe(false);
    expect(repo.getJson("personal")).toBe("garbage");
  });

  it("a personal read failure (rejected read) never writes", async () => {
    repo.readLibrary = async () => {
      throw new Error("EACCES");
    };
    await load();
    store.adapter.save({ libraryItems: [item("a")] });
    await vi.advanceTimersByTimeAsync(3000);
    await store.flush();
    expect(repo.writes).toHaveLength(0);
    expect(store.getErrors()[0]).toMatch(/EACCES/);
  });
});

describe("useVaultLibrary sections", () => {
  const sections = (store: LibraryStore, repo: FakeLibraryRepository) =>
    renderHook(() => useVaultLibrary({ store, repository: repo }, null)).result
      .current.libraryUIOptions!;

  it("read-only vault: the vault section has no add tile; personal does", async () => {
    const repo = new FakeLibraryRepository();
    const store = new LibraryStore(repo, { scheduleIdle: (run) => run() });
    await store.setVault("h", true);
    const opts = sections(store, repo);
    expect(opts.online).toBe(false);
    const list = opts.sections!.list;
    expect(list.map((s) => s.id)).toEqual(["personal", "vault"]);
    expect(list.find((s) => s.id === "vault")!.canAdd).toBe(false);
    expect(list.find((s) => s.id === "personal")!.canAdd).not.toBe(false);
    store.dispose();
  });

  it("writable vault: both sections addable; no vault: personal only", async () => {
    const repo = new FakeLibraryRepository();
    const store = new LibraryStore(repo, { scheduleIdle: (run) => run() });
    expect(sections(store, repo).sections!.list.map((s) => s.id)).toEqual([
      "personal",
    ]);
    await store.setVault("h");
    const list = sections(store, repo).sections!.list;
    expect(list.find((s) => s.id === "vault")!.canAdd).toBe(true);
    store.dispose();
  });

  it("an unreadable vault library file also disables its add tile", async () => {
    const repo = new FakeLibraryRepository();
    repo.setFile("vault", "{bad", "h");
    const store = new LibraryStore(repo, { scheduleIdle: (run) => run() });
    await store.setVault("h");
    await store.loadNow();
    const list = sections(store, repo).sections!.list;
    expect(list.find((s) => s.id === "vault")!.canAdd).toBe(false);
    store.dispose();
  });
});
