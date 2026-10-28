/**
 * VaultRepository contract tests against FakeVaultRepository (QA scope).
 *
 * Covers: relative-path rules (forward slashes, root = ""), scoped names,
 * create-only writes (expectedRevision null), revision-guarded writes,
 * folder/file CRUD, move validation, trash conservatism, recovery, export,
 * subscriptions, read-only mode, and errorMessage/joinPath helpers.
 *
 * These run WITHOUT editor deps or the root setupTests.ts.
 */
import { describe, expect, it } from "vitest";

import { errorMessage, joinPath } from "../vault/types";

import { FakeVaultError, FakeVaultRepository } from "./fakeVaultRepository";
import { BLANK_SCENE, IMAGE_SCENE, SAMPLE_SCENE } from "./fixtures";

const op = (n: number) => `test-op-${n}`;

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(FakeVaultError);
    expect((error as FakeVaultError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected rejection with code ${code}`);
}

describe("vault path contract", () => {
  it("joinPath treats root as empty string with forward slashes", () => {
    expect(joinPath("", "a.excalidraw")).toBe("a.excalidraw");
    expect(joinPath("DSA/DP", "1D DP.excalidraw")).toBe(
      "DSA/DP/1D DP.excalidraw",
    );
  });

  it("errorMessage supports Error instances and native {code,message} payloads", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(
      errorMessage({ code: "CONFLICT", message: "revision mismatch" }),
    ).toBe("revision mismatch");
    expect(errorMessage("plain")).toBe("plain");
  });

  it("rejects absolute paths, traversal, backslashes, and reserved metadata", async () => {
    const repo = new FakeVaultRepository();
    await expectCode(
      repo.readDrawing(repo.handle, "/abs/a.excalidraw"),
      "INVALID_PATH",
    );
    await expectCode(
      repo.readDrawing(repo.handle, "../escape.excalidraw"),
      "INVALID_PATH",
    );
    await expectCode(
      repo.readDrawing(repo.handle, "a/../b.excalidraw"),
      "INVALID_PATH",
    );
    await expectCode(
      repo.readDrawing(repo.handle, "a\\b.excalidraw"),
      "INVALID_PATH",
    );
    await expectCode(
      repo.readDrawing(repo.handle, ".excalidraw-vault/recovery/x.excalidraw"),
      "INVALID_PATH",
    );
  });

  it("requires the .excalidraw extension for drawings", async () => {
    const repo = new FakeVaultRepository();
    await expectCode(
      repo.writeDrawing({
        handle: repo.handle,
        path: "notes/todo.txt",
        json: BLANK_SCENE,
        expectedRevision: null,
        operationId: op(1),
      }),
      "INVALID_PATH",
    );
  });

  it("requires an operationId on writes", async () => {
    const repo = new FakeVaultRepository();
    await expectCode(
      repo.writeDrawing({
        handle: repo.handle,
        path: "a.excalidraw",
        json: BLANK_SCENE,
        expectedRevision: null,
        operationId: "",
      }),
      "INVALID_PATH",
    );
  });
});

describe("create-only and revision behavior", () => {
  it("create-only write never overwrites an existing drawing", async () => {
    const repo = new FakeVaultRepository();
    const first = await repo.writeDrawing({
      handle: repo.handle,
      path: "a.excalidraw",
      json: SAMPLE_SCENE,
      expectedRevision: null,
      operationId: op(1),
    });
    expect(first.revision).toBeTruthy();
    await expectCode(
      repo.writeDrawing({
        handle: repo.handle,
        path: "a.excalidraw",
        json: BLANK_SCENE,
        expectedRevision: null,
        operationId: op(2),
      }),
      "CONFLICT", // the native answer (shared table: vault_ops.json)
    );
    // Original content untouched.
    const disk = await repo.readDrawing(repo.handle, "a.excalidraw");
    expect(disk.json).toBe(SAMPLE_SCENE);
  });

  it("guarded write succeeds with matching revision and rejects on mismatch", async () => {
    const repo = new FakeVaultRepository();
    const created = await repo.writeDrawing({
      handle: repo.handle,
      path: "a.excalidraw",
      json: SAMPLE_SCENE,
      expectedRevision: null,
      operationId: op(1),
    });
    await expectCode(
      repo.writeDrawing({
        handle: repo.handle,
        path: "a.excalidraw",
        json: BLANK_SCENE,
        expectedRevision: "stale-rev",
        operationId: op(2),
      }),
      "CONFLICT",
    );
    const ack = await repo.writeDrawing({
      handle: repo.handle,
      path: "a.excalidraw",
      json: BLANK_SCENE,
      expectedRevision: created.revision,
      operationId: op(3),
    });
    expect(ack.revision).not.toBe(created.revision);
  });

  it("image scenes survive a write/read round trip byte-identically", async () => {
    const repo = new FakeVaultRepository();
    const created = await repo.writeDrawing({
      handle: repo.handle,
      path: "img.excalidraw",
      json: IMAGE_SCENE,
      expectedRevision: null,
      operationId: op(1),
    });
    const disk = await repo.readDrawing(repo.handle, "img.excalidraw");
    expect(disk.json).toBe(IMAGE_SCENE);
    expect(disk.revision).toBe(created.revision);
  });

  it("reading a missing drawing reports NOT_FOUND", async () => {
    const repo = new FakeVaultRepository();
    await expectCode(
      repo.readDrawing(repo.handle, "missing.excalidraw"),
      "NOT_FOUND",
    );
  });
});

describe("directory listing and CRUD", () => {
  it("lists root and nested folders with drawing/file distinction", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("DSA/Dynamic Programming/1D DP.excalidraw", SAMPLE_SCENE);
    repo.seedDrawing("DSA/Graphs/BFS.excalidraw", BLANK_SCENE);
    const root = await repo.listDirectory(repo.handle, "");
    expect(root.map((e) => e.name)).toEqual(["DSA"]);
    expect(root[0].kind).toBe("folder");
    const dsa = await repo.listDirectory(repo.handle, "DSA");
    expect(dsa.map((e) => e.name).sort()).toEqual([
      "Dynamic Programming",
      "Graphs",
    ]);
    const dp = await repo.listDirectory(repo.handle, "DSA/Dynamic Programming");
    expect(dp).toHaveLength(1);
    expect(dp[0]).toMatchObject({ name: "1D DP.excalidraw", kind: "drawing" });
    expect(dp[0].size).toBe(SAMPLE_SCENE.length);
  });

  it("createFolder rejects the vault root; a drawing-like name is the file tree's rule, not the backend's", async () => {
    const repo = new FakeVaultRepository();
    await expectCode(repo.createFolder(repo.handle, ""), "INVALID_PATH");
    await repo.createFolder(repo.handle, "x.excalidraw");
  });

  it("move relocates files and folders without changing content revision", async () => {
    const repo = new FakeVaultRepository();
    const rev = repo.seedDrawing("a/b.excalidraw", SAMPLE_SCENE);
    repo.seedFolder("c");
    await repo.move(repo.handle, "a/b.excalidraw", "c/d.excalidraw");
    await expectCode(
      repo.readDrawing(repo.handle, "a/b.excalidraw"),
      "NOT_FOUND",
    );
    const moved = await repo.readDrawing(repo.handle, "c/d.excalidraw");
    expect(moved).toEqual({ json: SAMPLE_SCENE, revision: rev });
  });

  it("move refuses self-nesting, collisions, and missing sources", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a/x.excalidraw", BLANK_SCENE);
    repo.seedDrawing("b.excalidraw", BLANK_SCENE);
    await expectCode(repo.move(repo.handle, "a", "a/nested"), "INVALID_PATH");
    await expectCode(
      repo.move(repo.handle, "a/x.excalidraw", "b.excalidraw"),
      "NAME_COLLISION",
    );
    await expectCode(
      repo.move(repo.handle, "nope.excalidraw", "x.excalidraw"),
      "NOT_FOUND",
    );
    await expectCode(repo.move(repo.handle, "", "x"), "INVALID_PATH");
  });

  it("trash deletes files and folders with their contents, but not the vault root", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a/x.excalidraw", BLANK_SCENE);
    await repo.trash(repo.handle, "a/x.excalidraw");
    await expectCode(
      repo.readDrawing(repo.handle, "a/x.excalidraw"),
      "NOT_FOUND",
    );
    repo.seedDrawing("b/y.excalidraw", BLANK_SCENE);
    expect(await repo.countFolderItems!(repo.handle, "b")).toEqual({
      count: 1,
      capped: false,
    });
    await repo.trash(repo.handle, "b");
    await expectCode(
      repo.readDrawing(repo.handle, "b/y.excalidraw"),
      "NOT_FOUND",
    );
    await expectCode(repo.trash(repo.handle, ""), "INVALID_PATH");
    await expectCode(repo.trash(repo.handle, "ghost.excalidraw"), "NOT_FOUND");
  });
});

describe("vault lifecycle, recovery, export, subscriptions", () => {
  it("choose/reopen/release follow the approved lifecycle", async () => {
    const repo = new FakeVaultRepository();
    expect(await repo.chooseVault()).toMatchObject({ handle: repo.handle });
    expect(await repo.reopenVault()).toMatchObject({ handle: repo.handle });
    await repo.releaseVault(repo.handle);
    expect(await repo.reopenVault()).toBeNull();
    await expectCode(repo.listDirectory(repo.handle, ""), "NOT_FOUND");
  });

  it("rejects unknown vault handles", async () => {
    const repo = new FakeVaultRepository();
    await expectCode(repo.listDirectory("wrong-handle", ""), "NOT_FOUND");
  });

  it("lists and discards recovery entries", async () => {
    const repo = new FakeVaultRepository();
    const entry = repo.seedRecovery("a.excalidraw", SAMPLE_SCENE);
    const listed = await repo.listRecovery(repo.handle);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: entry.id, path: "a.excalidraw" });
    await repo.discardRecovery(repo.handle, entry.id);
    expect(await repo.listRecovery(repo.handle)).toHaveLength(0);
    await expectCode(repo.discardRecovery(repo.handle, entry.id), "NOT_FOUND");
  });

  it("exportFile records the export payload and reports success", async () => {
    const repo = new FakeVaultRepository();
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await repo.exportFile("copy.excalidraw", bytes)).toBe(true);
    expect(repo.exported).toEqual([{ name: "copy.excalidraw", bytes }]);
    await expectCode(repo.exportFile("", bytes), "INVALID_PATH");
  });

  it("subscribe delivers vault-change events and unsubscribes cleanly", async () => {
    const repo = new FakeVaultRepository();
    const seen: string[][] = [];
    const off = await repo.subscribe((event) => seen.push(event.paths));
    await repo.writeDrawing({
      handle: repo.handle,
      path: "a.excalidraw",
      json: BLANK_SCENE,
      expectedRevision: null,
      operationId: op(1),
    });
    expect(seen).toEqual([["a.excalidraw"]]);
    off();
    await repo.writeDrawing({
      handle: repo.handle,
      path: "b.excalidraw",
      json: BLANK_SCENE,
      expectedRevision: null,
      operationId: op(2),
    });
    expect(seen).toHaveLength(1);
  });

  it("read-only vaults block writes, moves, folder creation, and trash", async () => {
    const repo = new FakeVaultRepository({ readOnly: true });
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    expect(await repo.readDrawing(repo.handle, "a.excalidraw")).toBeTruthy();
    await expectCode(
      repo.writeDrawing({
        handle: repo.handle,
        path: "b.excalidraw",
        json: BLANK_SCENE,
        expectedRevision: null,
        operationId: op(1),
      }),
      "READ_ONLY",
    );
    await expectCode(repo.createFolder(repo.handle, "new"), "READ_ONLY");
    await expectCode(
      repo.move(repo.handle, "a.excalidraw", "b.excalidraw"),
      "READ_ONLY",
    );
    await expectCode(repo.trash(repo.handle, "a.excalidraw"), "READ_ONLY");
  });
});
