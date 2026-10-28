import { newElement } from "@excalidraw/element";
import { serializeLibraryAsJSON } from "@excalidraw/excalidraw";

import type { LibraryItem } from "@excalidraw/excalidraw/types";

import { LibraryStore } from "../library/libraryStore";

import { FakeLibraryRepository } from "./fakeLibraryRepository";

const item = (id: string, name?: string): LibraryItem => ({
  id,
  ...(name ? { name } : {}),
  status: "unpublished",
  created: 1,
  elements: [
    newElement({ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }) as any,
  ],
});
const fileOf = (...items: LibraryItem[]) => serializeLibraryAsJSON(items);
const written = (repo: FakeLibraryRepository, scope: "personal" | "vault") =>
  JSON.parse(repo.getJson(scope, scope === "vault" ? "h" : undefined)!)
    .libraryItems as LibraryItem[];
const nameOf = (items: LibraryItem[], id: string) =>
  items.find((i) => i.id === id)?.name;

describe("LibraryStore item names", () => {
  let repo: FakeLibraryRepository;
  let store: LibraryStore;

  beforeEach(async () => {
    vi.useFakeTimers();
    repo = new FakeLibraryRepository();
    repo.setFile("personal", fileOf(item("p")));
    repo.setFile("vault", fileOf(item("v")), "h");
    store = new LibraryStore(repo, { scheduleIdle: (run) => run() });
    await store.setVault("h");
    await store.loadNow();
  });
  afterEach(() => {
    store.dispose();
    vi.useRealTimers();
  });

  const rename = async (id: string, name: string | undefined) => {
    const items = store.union().map((i) => (i.id === id ? item(id, name) : i));
    await store.adapter.save({ libraryItems: items });
    await vi.advanceTimersByTimeAsync(700);
  };

  it("renaming a vault item writes only the vault file", async () => {
    await rename("v", "Flowchart");
    expect(repo.writes.map((w) => w.key)).toEqual(["vault:h"]);
    expect(nameOf(written(repo, "vault"), "v")).toBe("Flowchart");
    expect(written(repo, "personal")[0].name).toBeUndefined();
  });

  it("renaming a personal item writes only the personal file", async () => {
    await rename("p", "Logo");
    expect(repo.writes.map((w) => w.key)).toEqual(["personal"]);
    expect(nameOf(written(repo, "personal"), "p")).toBe("Logo");
    expect(nameOf(written(repo, "vault"), "v")).toBeUndefined();
  });

  it("removing a name is persisted too", async () => {
    await rename("v", "Flowchart");
    await rename("v", undefined);
    expect(written(repo, "vault")[0]).not.toHaveProperty("name");
    expect(repo.writes).toHaveLength(2);
  });

  it("a name survives a reload from the written files", async () => {
    await rename("v", "Flowchart");
    await rename("p", "Logo");
    store.dispose();

    const reloaded = new LibraryStore(repo, { scheduleIdle: (run) => run() });
    await reloaded.setVault("h");
    await reloaded.loadNow();
    const items = reloaded.union();
    expect(nameOf(items as LibraryItem[], "v")).toBe("Flowchart");
    expect(nameOf(items as LibraryItem[], "p")).toBe("Logo");
    expect(reloaded.sectionOf("v")).toBe("vault");
    reloaded.dispose();
  });

  it("listItems gives id, name (null when unnamed) and scope", async () => {
    await rename("v", "  Flowchart ");
    store.assign(["p"], "personal");
    expect(store.listItems()).toEqual([
      { id: "p", name: null, scope: "personal", library: "Personal" },
      { id: "v", name: "Flowchart", scope: "vault", library: "This vault" },
    ]);
    await rename("p", "Logo");
    await rename("v", undefined);
    expect(store.listItems()).toEqual([
      { id: "p", name: "Logo", scope: "personal", library: "Personal" },
      { id: "v", name: null, scope: "vault", library: "This vault" },
    ]);
  });

  it("listItems treats a blank name as unnamed", async () => {
    await rename("p", "   ");
    expect(store.listItems().find((i) => i.id === "p")?.name).toBeNull();
  });

  it("getItem finds items of both libraries, undefined otherwise", async () => {
    await rename("v", "Flowchart");
    expect(store.getItem("v")?.name).toBe("Flowchart");
    expect(store.getItem("v")?.elements).toHaveLength(1);
    expect(store.getItem("p")?.id).toBe("p");
    expect(store.getItem("nope")).toBeUndefined();
  });
});
