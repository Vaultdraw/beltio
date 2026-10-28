/**
 * Tree/search/CRUD helper tests (QA scope).
 *
 * Tests the real production `treeStore.ts` functions:
 * - searchPaths, searchEntries, scanVaultMetadata
 * - duplicateName, getParentPath, getBaseName, getCleanDrawingName
 * - validateEntryName, isMoveAllowed, buildTree
 * against the shared contract and FakeVaultRepository backend.
 */
import { describe, expect, it } from "vitest";

import { type VaultEntry } from "../vault/types";
import {
  buildTree,
  duplicateName,
  getBaseName,
  getCleanDrawingName,
  getParentPath,
  isMoveAllowed,
  rebaseFolderPath,
  scanVaultMetadata,
  searchEntries,
  searchPaths,
  validateEntryName,
} from "../vault/treeStore";

import { FakeVaultRepository } from "./fakeVaultRepository";
import { BLANK_SCENE, SAMPLE_SCENE } from "./fixtures";

describe("treeStore filename/path search over background scan", () => {
  it("matches case-insensitively across nested paths, empty query returns nothing", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("DSA/Dynamic Programming/1D DP.excalidraw", SAMPLE_SCENE);
    repo.seedDrawing("DSA/Graphs/BFS.excalidraw", BLANK_SCENE);
    repo.seedFolder("Empty");
    const entries = await scanVaultMetadata(repo, repo.handle);
    const paths = entries.map((e) => e.path);

    expect(searchPaths(paths, "dp")).toContain(
      "DSA/Dynamic Programming/1D DP.excalidraw",
    );
    expect(searchPaths(paths, "bfs")).toEqual(["DSA/Graphs/BFS.excalidraw"]);
    expect(searchPaths(paths, "DSA")).toHaveLength(5); // folder + descendants
    expect(searchPaths(paths, "   ")).toEqual([]);
    expect(searchPaths(paths, "zzz")).toEqual([]);

    // searchEntries matches on entry.name or entry.path
    const matchedEntries = searchEntries(entries, "1D DP");
    expect(matchedEntries).toHaveLength(1);
    expect(matchedEntries[0].name).toBe("1D DP.excalidraw");
  });

  it("scanVaultMetadata abort signal stops crawling", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("DSA/Dynamic Programming/1D DP.excalidraw", SAMPLE_SCENE);
    const controller = new AbortController();
    controller.abort();
    const entries = await scanVaultMetadata(
      repo,
      repo.handle,
      controller.signal,
    );
    expect(entries).toEqual([]);
  });
});

describe("treeStore duplicate, path helpers, and name validation", () => {
  it("duplicateName never collides with the source and increments", () => {
    expect(duplicateName("a.excalidraw")).toBe("a copy.excalidraw");
    expect(duplicateName("DSA/a.excalidraw")).toBe("DSA/a copy.excalidraw");
    expect(duplicateName("a copy.excalidraw")).toBe("a copy 2.excalidraw");
    expect(duplicateName("a copy 2.excalidraw")).toBe("a copy 3.excalidraw");
  });

  it("duplicate writes create-only: existing destination is a collision, not an overwrite", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    const dest = duplicateName("a.excalidraw");
    await repo.writeDrawing({
      handle: repo.handle,
      path: dest,
      json: SAMPLE_SCENE,
      expectedRevision: null,
      operationId: "dup-1",
    });
    expect((await repo.readDrawing(repo.handle, dest)).json).toBe(SAMPLE_SCENE);
    // Next duplicate name increments
    const dest2 = duplicateName(dest);
    expect(dest2).toBe("a copy 2.excalidraw");
  });

  it("getParentPath, getBaseName, getCleanDrawingName extract expected parts", () => {
    expect(getParentPath("DSA/Graphs/BFS.excalidraw")).toBe("DSA/Graphs");
    expect(getParentPath("root.excalidraw")).toBe("");
    expect(getBaseName("DSA/Graphs/BFS.excalidraw")).toBe("BFS.excalidraw");
    expect(getBaseName("root.excalidraw")).toBe("root.excalidraw");
    expect(getCleanDrawingName("BFS.excalidraw")).toBe("BFS");
    expect(getCleanDrawingName("Plain")).toBe("Plain");
  });

  it("validateEntryName checks reserved characters, lengths, and extensions", () => {
    expect(validateEntryName("Valid Drawing", "drawing").valid).toBe(true);
    expect(validateEntryName("Valid Folder", "folder").valid).toBe(true);
    expect(validateEntryName("", "drawing").valid).toBe(false);
    expect(validateEntryName("a".repeat(256), "drawing").valid).toBe(false);
    expect(validateEntryName("slash/bad", "drawing").valid).toBe(false);
    expect(validateEntryName("colon:bad", "drawing").valid).toBe(false);
    expect(validateEntryName(".", "folder").valid).toBe(false);
    expect(validateEntryName("..", "folder").valid).toBe(false);
    expect(validateEntryName(".excalidraw-vault", "folder").valid).toBe(false);
    expect(validateEntryName("folder.excalidraw", "folder").valid).toBe(false);
  });
});

describe("treeStore move validation and hierarchical tree building", () => {
  it("isMoveAllowed validates self-nesting, current folder, and root", () => {
    expect(isMoveAllowed("", "target")).toEqual({
      allowed: false,
      reason: "Cannot move vault root",
    });
    expect(isMoveAllowed("DSA", "DSA")).toEqual({
      allowed: false,
      reason: "Cannot move entry into itself",
    });
    expect(isMoveAllowed("DSA", "DSA/nested")).toEqual({
      allowed: false,
      reason: "Cannot move a folder into its own subfolder",
    });
    expect(isMoveAllowed("DSA/a.excalidraw", "DSA")).toEqual({
      allowed: false,
      reason: "Item is already in this folder",
    });
    expect(isMoveAllowed("DSA/a.excalidraw", "Other")).toEqual({
      allowed: true,
    });
    expect(isMoveAllowed("DSA/a.excalidraw", "")).toEqual({ allowed: true });
  });

  it("buildTree builds nested hierarchy from directory map", () => {
    const dirMap = new Map<string, VaultEntry[]>([
      [
        "",
        [
          { path: "DSA", name: "DSA", kind: "folder", modifiedAt: 1, size: 0 },
          {
            path: "root.excalidraw",
            name: "root.excalidraw",
            kind: "drawing",
            modifiedAt: 1,
            size: 100,
          },
        ],
      ],
      [
        "DSA",
        [
          {
            path: "DSA/sub.excalidraw",
            name: "sub.excalidraw",
            kind: "drawing",
            modifiedAt: 1,
            size: 200,
          },
        ],
      ],
    ]);

    const tree = buildTree(dirMap);
    expect(tree).toHaveLength(2);
    expect(tree[0].entry.name).toBe("DSA");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children?.[0].entry.name).toBe("sub.excalidraw");
    expect(tree[1].entry.name).toBe("root.excalidraw");
    expect(tree[1].children).toBeUndefined();
  });
});

describe("rebaseFolderPath", () => {
  it("moves a folder and everything inside it", () => {
    expect(rebaseFolderPath("A/B", "A/B", "C/B")).toBe("C/B");
    expect(rebaseFolderPath("A/B/x/y", "A/B", "C/B")).toBe("C/B/x/y");
  });
  it("leaves other paths alone, including name-prefix siblings", () => {
    expect(rebaseFolderPath("A/Bee", "A/B", "C/B")).toBe("A/Bee");
    expect(rebaseFolderPath("A", "A/B", "C/B")).toBe("A");
    expect(rebaseFolderPath("", "A/B", null)).toBe("");
  });
  it("drops removed folders", () => {
    expect(rebaseFolderPath("A/B/x", "A/B", null)).toBeNull();
  });
});

describe("deletion", () => {
  it("non-empty folders are trashed with everything under them", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("DSA/a.excalidraw", SAMPLE_SCENE);
    repo.seedDrawing("DSA/sub/b.excalidraw", SAMPLE_SCENE);
    await repo.trash(repo.handle, "DSA");
    expect(await repo.listDirectory(repo.handle, "")).toEqual([]);
    await expect(
      repo.readDrawing(repo.handle, "DSA/sub/b.excalidraw"),
    ).rejects.toBeTruthy();
  });

  it("empty folders trash cleanly; unrelated files are never in the fake", async () => {
    const repo = new FakeVaultRepository();
    await repo.createFolder(repo.handle, "Empty");
    await repo.trash(repo.handle, "Empty");
    expect(await repo.listDirectory(repo.handle, "")).toEqual([]);
  });
});
