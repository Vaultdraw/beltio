import { describe, expect, it } from "vitest";

import { FakeVaultRepository } from "./fakeVaultRepository";

const json = "{}";

describe("FakeVaultRepository name rules (mirror the native ones)", () => {
  const make = () => {
    const repo = new FakeVaultRepository();
    return { repo, handle: repo.handle };
  };
  const create = (r: ReturnType<typeof make>, path: string) =>
    r.repo.writeDrawing({
      handle: r.handle,
      path,
      json,
      expectedRevision: null,
      operationId: `op-${path}`,
    });

  it("refuses dot-named components", async () => {
    const r = make();
    await expect(create(r, ".hidden.excalidraw")).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
    await expect(
      r.repo.createFolder(r.handle, ".obsidian"),
    ).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
  });

  it("refuses a sibling that differs only in case, and an existing folder", async () => {
    const r = make();
    await create(r, "Case.excalidraw");
    await expect(create(r, "CASE.excalidraw")).rejects.toMatchObject({
      code: "NAME_COLLISION",
    });
    await r.repo.createFolder(r.handle, "Dir");
    await expect(r.repo.createFolder(r.handle, "Dir")).rejects.toMatchObject({
      code: "NAME_COLLISION",
    });
    await expect(r.repo.createFolder(r.handle, "dir")).rejects.toMatchObject({
      code: "NAME_COLLISION",
    });
    await expect(
      r.repo.move(r.handle, "Case.excalidraw", ".x.excalidraw"),
    ).rejects.toMatchObject({ code: "INVALID_PATH" });
    // A case-only rename of the same entry is allowed.
    await r.repo.move(r.handle, "Case.excalidraw", "case.excalidraw");
  });

  it("refuses a rename onto an accent-case or Unicode-form twin, like the native check", async () => {
    const r = make();
    await create(r, "été.excalidraw");
    await create(r, "notes.excalidraw");
    await expect(
      r.repo.move(r.handle, "notes.excalidraw", "Été.excalidraw"),
    ).rejects.toMatchObject({ code: "NAME_COLLISION" });
    await create(r, "caf\u00e9.excalidraw");
    await expect(
      r.repo.move(r.handle, "notes.excalidraw", "cafe\u0301.excalidraw"),
    ).rejects.toMatchObject({ code: "NAME_COLLISION" });
    // The same entry under a new case is still fine.
    await r.repo.move(r.handle, "notes.excalidraw", "Notes.excalidraw");
  });

  it("never lists dot-named entries", async () => {
    const r = make();
    r.repo.seedFolder(".obsidian");
    r.repo.seedFolder("Notes");
    r.repo.seedNote(".hidden.md");
    r.repo.seedNote("Notes/visible.md");
    const names = (await r.repo.listDirectory(r.handle, "")).map((e) => e.name);
    expect(names).toEqual(["Notes"]);
  });
});
