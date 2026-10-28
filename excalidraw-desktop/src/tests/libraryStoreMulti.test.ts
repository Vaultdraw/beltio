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
const idsOf = (json: string | null) =>
  (JSON.parse(json!).libraryItems as LibraryItem[]).map((i) => i.id);

describe("LibraryStore named libraries", () => {
  let repo: FakeLibraryRepository;
  let store: LibraryStore;
  const settle = () => vi.advanceTimersByTimeAsync(5000);

  beforeEach(async () => {
    vi.useFakeTimers();
    repo = new FakeLibraryRepository();
    repo.setFile("personal", fileOf(item("p", "Plain")));
    repo.setFile("personal", fileOf(item("a1", "Arrow")), undefined, "Arrows");
    repo.setFile("personal", fileOf(item("b1", "Box")), undefined, "Boxes");
    store = new LibraryStore(repo, { scheduleIdle: (run) => run() });
    await store.loadNow();
  });
  afterEach(() => {
    store.dispose();
    vi.useRealTimers();
  });

  it("lists every file as its own section and merges the items", () => {
    expect(store.getSections().map((s) => s.label)).toEqual([
      "Personal",
      "Arrows",
      "Boxes",
    ]);
    expect(store.union().map((i) => i.id)).toEqual(["p", "a1", "b1"]);
    expect(store.sectionOf("a1")).toBe("lib:personal::Arrows");
    expect(store.sectionOf("p")).toBe("personal");
  });

  it("lists items across all libraries for the palette, with the library name", () => {
    expect(store.listItems().map((i) => [i.name, i.library])).toEqual([
      ["Plain", "Personal"],
      ["Arrow", "Arrows"],
      ["Box", "Boxes"],
    ]);
  });

  it("moves an item between libraries and writes both files", async () => {
    store.assign(["p"], "lib:personal::Boxes");
    await settle();
    expect(idsOf(repo.getJson("personal", undefined))).toEqual([]);
    expect(idsOf(repo.getJson("personal", undefined, "Boxes"))).toEqual([
      "p",
      "b1",
    ]);
    expect(store.sectionOf("p")).toBe("lib:personal::Boxes");
  });

  it("sends new items to the default library", async () => {
    await store.configure([], "Boxes");
    store.adapter.save({
      libraryItems: [...store.union(), item("n", "New")],
    });
    await settle();
    expect(idsOf(repo.getJson("personal", undefined, "Boxes"))).toContain("n");
    expect(store.sectionOf("n")).toBe("lib:personal::Boxes");
  });

  it("falls back to Personal when the default library does not exist", async () => {
    await store.configure([], "Nope");
    store.adapter.save({ libraryItems: [...store.union(), item("n")] });
    await settle();
    expect(idsOf(repo.getJson("personal", undefined))).toContain("n");
  });

  it("creates, renames and removes a library", async () => {
    await store.createLibrary("personal", "Icons");
    expect(store.getSections().map((s) => s.label)).toContain("Icons");
    await store.renameLibrary("lib:personal::Icons", "Symbols");
    expect(store.getSections().map((s) => s.label)).toContain("Symbols");
    expect(store.getSections().map((s) => s.label)).not.toContain("Icons");
    await store.removeLibrary("lib:personal::Arrows");
    expect(store.union().map((i) => i.id)).toEqual(["p", "b1"]);
    expect(repo.removed).toHaveLength(1);
  });

  it("picks up an outside edit and a new file live", async () => {
    repo.setFile("personal", fileOf(item("a1"), item("a2")), undefined, "Arrows");
    repo.setFile("personal", fileOf(item("c1")), undefined, "Curves");
    await settle();
    expect(store.union().map((i) => i.id)).toEqual(["p", "a1", "a2", "b1", "c1"]);
    expect(store.getSections().map((s) => s.label)).toContain("Curves");
    repo.setFile("personal", null, undefined, "Curves");
    await settle();
    expect(store.getSections().map((s) => s.label)).not.toContain("Curves");
    expect(store.union().map((i) => i.id)).not.toContain("c1");
  });

  it("keeps vault libraries separate and drops them with the vault", async () => {
    repo.setFile("vault", fileOf(item("v")), "h");
    repo.setFile("vault", fileOf(item("vl")), "h", "Team");
    await store.setVault("h");
    await settle();
    expect(store.getSections().map((s) => s.label)).toEqual([
      "Personal",
      "This vault",
      "Arrows",
      "Boxes",
      "Team",
    ]);
    await store.setVault(null);
    expect(store.getSections().map((s) => s.label)).not.toContain("Team");
    expect(store.union().map((i) => i.id)).not.toContain("vl");
  });

  it("reads extra folders as their own libraries", async () => {
    repo.setFile("folder", fileOf(item("f1")), "/libs", "Shared");
    await store.configure(["/libs"], "");
    expect(store.getSections().map((s) => s.label)).toContain("Shared");
    expect(store.sectionOf("f1")).toBe("lib:folder:/libs:Shared");
  });
});
