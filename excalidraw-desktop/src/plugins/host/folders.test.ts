/**
 * `ctx.folders` (API 0.9.0) through the real host over the fake backend's
 * `folders.*` rows: permission, sources, targets, open().
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { boot, type TestPlugin } from "../testing";

import type { PluginContext, PluginPermission } from "../api";

let t: TestPlugin | undefined;
let ctx: PluginContext;
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await t?.dispose();
  t = undefined;
  vi.restoreAllMocks();
});

const bootFolders = async (
  permissions: PluginPermission[] = ["folders.import"],
) => {
  t = await boot(
    { id: "fo", permissions, activation: ["onStartupFinished"] },
    {
      activate(c) {
        ctx = c;
      },
    },
  );
  return t;
};

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? "no code",
  );

const SOURCE = {
  name: "Notes",
  files: {
    "a.md": "# A",
    "sub/b.md": "# B",
    "img/p.png": new Uint8Array([1, 2, 3]),
    ".obsidian/app.json": "{}",
  },
};

describe("ctx.folders", () => {
  it("every call needs folders.import", async () => {
    await bootFolders([]);
    expect(await code(ctx.folders.pickSource())).toBe("PERMISSION");
    expect(await code(ctx.folders.pickTarget({ kind: "newVault" }))).toBe(
      "PERMISSION",
    );
    expect(
      await code(ctx.folders.pickTarget({ kind: "vaultFolder", path: "x" })),
    ).toBe("PERMISSION");
  });

  it("pickSource: null when cancelled; a read-only folder that skips dot entries", async () => {
    const p = await bootFolders();
    expect(await ctx.folders.pickSource()).toBeNull();
    p.folders.setSource(SOURCE);
    const src = await ctx.folders.pickSource({ title: "Pick" });
    expect(src?.name).toBe("Notes");
    expect((await src!.list()).map((e) => e.path)).toEqual([
      "a.md",
      "img/p.png",
      "sub/b.md",
    ]);
    expect(await src!.readText("sub/b.md")).toBe("# B");
    expect([...(await src!.readBytes("img/p.png"))]).toEqual([1, 2, 3]);
    expect(await code(src!.readText("nope.md"))).toBe("NOT_FOUND");
    expect(await code(src!.readText("../x"))).toBe("INVALID_PATH");
    expect(await code(src!.readText(".obsidian/app.json"))).toBe(
      "INVALID_PATH",
    );
    expect((src as { write?: unknown }).write).toBeUndefined();
  });

  it("a new vault: create-only writes, native copies, open() opens it as the vault", async () => {
    const p = await bootFolders();
    expect(await ctx.folders.pickTarget({ kind: "newVault" })).toBeNull();
    p.folders.setSource(SOURCE);
    p.folders.setNewVault("Imported");
    const src = (await ctx.folders.pickSource())!;
    const target = (await ctx.folders.pickTarget({ kind: "newVault" }))!;
    expect(target).toMatchObject({ name: "Imported", kind: "newVault" });
    const scene = await ctx.pages.buildScene([], { pageCount: 1 });
    await target.writeDrawing("a.excalidraw", scene);
    expect(await code(target.writeDrawing("a.excalidraw", scene))).toBe(
      "NAME_COLLISION",
    );
    expect(await code(target.writeDrawing("a.md", scene))).toBe("INVALID_PATH");
    expect(await code(target.writeDrawing("b.excalidraw", [] as never))).toBe(
      "INVALID_ARGUMENT",
    );
    await target.copyFrom(src, "img/p.png", "attachments/p.png");
    expect(
      await code(target.copyFrom(src, "img/p.png", "attachments/p.png")),
    ).toBe("NAME_COLLISION");
    expect(await code(target.copyFrom(src, "zzz.png", "z.png"))).toBe(
      "NOT_FOUND",
    );
    expect(
      await code(target.copyFrom({ name: "fake" } as never, "a.md", "a.md")),
    ).toBe("INVALID_ARGUMENT");
    const [written] = p.folders.targets();
    expect(Object.keys(written.files).sort()).toEqual([
      "a.excalidraw",
      "attachments/p.png",
    ]);
    expect([...(written.files["attachments/p.png"] as Uint8Array)]).toEqual([
      1, 2, 3,
    ]);
    await target.open();
    expect(p.workspace.openedVaults()).toEqual(["/fake/vaults/Imported"]);
  });

  it("a vault folder: drawings land in the open vault, open() reveals the folder", async () => {
    const p = await bootFolders();
    const target = (await ctx.folders.pickTarget({
      kind: "vaultFolder",
      path: "Imported/Notes",
    }))!;
    expect(target).toMatchObject({ name: "Notes", kind: "vaultFolder" });
    await target.writeDrawing(
      "a.excalidraw",
      await ctx.pages.buildScene([], { pageCount: 1 }),
    );
    expect(Object.keys(p.vault.drawings())).toContain(
      "Imported/Notes/a.excalidraw",
    );
    await target.open();
    expect(p.workspace.revealed()).toEqual(["Imported/Notes"]);
    expect(
      await code(ctx.folders.pickTarget({ kind: "vaultFolder", path: ".git" })),
    ).toBe("INVALID_PATH");
    p.vault.setVault({ name: "ro", readOnly: true });
    expect(
      await code(ctx.folders.pickTarget({ kind: "vaultFolder", path: "x" })),
    ).toBe("READ_ONLY");
    p.vault.setVault(null);
    expect(
      await code(ctx.folders.pickTarget({ kind: "vaultFolder", path: "x" })),
    ).toBe("NO_VAULT");
  });
});
