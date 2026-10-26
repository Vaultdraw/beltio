import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkVaultPath } from "../../../../sdk/api/shared/vaultPaths";

import { appEvents } from "../../events/appEvents";
import { setWorkspaceBridge } from "../workspaceBridge";
import { boot, type TestPlugin } from "../testing";

import { getRuntime } from "./activation";

import { getPluginsBackend } from "./backend";

import type { createFakeBackend } from "./fakeBackend";

import type { PluginContext } from "../api";

vi.mock("./vaultContext", async (orig) => {
  const m = await orig<typeof import("./vaultContext")>();
  return { ...m, createVaultApi: vi.fn(m.createVaultApi) };
});

let t: TestPlugin | undefined;
let ctx: PluginContext;
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  await t?.dispose();
  t = undefined;
  vi.restoreAllMocks();
});

const bootVault = async (
  permissions: ("vault.read" | "vault.write")[] = [],
  getCtx: (c: PluginContext) => void = () => {},
) => {
  t = await boot(
    { id: "vp", permissions, activation: ["onStartupFinished"] },
    {
      activate(c) {
        ctx = c;
        getCtx(c);
      },
    },
  );
  return t;
};

const rect = { type: "rectangle", x: 1, y: 2, width: 30, height: 40 } as const;

describe("path rules against the shared corpus", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const corpus = JSON.parse(
    readFileSync(
      join(here, "../../../../sdk/api/test/vault-paths.json"),
      "utf8",
    ),
  ) as { path: string; kind: "file" | "folder"; code: string | null }[];

  it("has cases", () => {
    expect(corpus.length).toBeGreaterThan(20);
  });

  it.each(corpus.map((c, i) => [i, c] as const))("case %i", (_i, c) => {
    const run = () => checkVaultPath(c.path, c.kind);
    if (c.code === null) {
      expect(run).not.toThrow();
    } else {
      expect(run).toThrowError(expect.objectContaining({ code: c.code }));
    }
  });
});

describe("ctx.vault permissions", () => {
  it("every call refuses without its declared permission, before any native call", async () => {
    await bootVault([]);
    const calls = (getPluginsBackend() as ReturnType<typeof createFakeBackend>)
      .gatewayCalls;
    for (const run of [
      () => ctx.vault.list(),
      () => ctx.vault.readDrawing("a.excalidraw"),
      () => ctx.vault.createDrawing("a.excalidraw", []),
    ]) {
      await expect(run()).rejects.toMatchObject({ code: "PERMISSION" });
    }
    expect(calls.filter((c) => c.method !== "storage.read")).toEqual([]);
  });

  it("vault.read does not allow createDrawing, vault.write does not allow reading", async () => {
    await bootVault(["vault.read"]);
    await expect(
      ctx.vault.createDrawing("a.excalidraw", []),
    ).rejects.toMatchObject({ code: "PERMISSION", permission: "vault.write" });
    await t!.dispose();
    await bootVault(["vault.write"]);
    await expect(ctx.vault.list()).rejects.toMatchObject({
      code: "PERMISSION",
      permission: "vault.read",
    });
  });

  it("info() and the workspace are free", async () => {
    await bootVault([]);
    expect(ctx.vault.info()).toEqual({ name: "mock-vault", readOnly: false });
    expect(ctx.workspace.activePath()).toBe("fake.excalidraw");
    t!.vault.setVault(null);
    expect(ctx.vault.info()).toBeNull();
  });
});

describe("ctx.vault calls", () => {
  it("checks paths before the native call", async () => {
    await bootVault(["vault.read", "vault.write"]);
    const calls = (getPluginsBackend() as ReturnType<typeof createFakeBackend>)
      .gatewayCalls;
    const before = calls.length;
    await expect(ctx.vault.list(".git")).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
    await expect(ctx.vault.readDrawing("a.txt")).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
    await expect(
      ctx.vault.createDrawing("../a.excalidraw", []),
    ).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
    expect(calls.length).toBe(before);
  });

  it("lists a folder through vault.list", async () => {
    await bootVault(["vault.read"]);
    t!.vault.seed({
      "a.excalidraw": [rect],
      "sub/b.excalidraw": [rect],
    });
    const root = await ctx.vault.list();
    expect(root.map((e) => [e.name, e.kind])).toEqual([
      ["sub", "folder"],
      ["a.excalidraw", "drawing"],
    ]);
    const sub = await ctx.vault.list("sub");
    expect(sub.map((e) => e.path)).toEqual(["sub/b.excalidraw"]);
  });

  it("readDrawing projects slim elements, leaves out deleted ones and returns the revision", async () => {
    await bootVault(["vault.read"]);
    t!.vault.seed({ "a.excalidraw": [{ ...rect, id: "r1" }] });
    const backend = getPluginsBackend() as ReturnType<typeof createFakeBackend>;
    const els = backend.drawings["a.excalidraw"].scene.elements as {
      id: string;
      isDeleted?: boolean;
    }[];
    els.push({ ...els[0], id: "gone", isDeleted: true });
    const r = await ctx.vault.readDrawing("a.excalidraw");
    expect(r.revision).toBe("seed");
    expect(r.elements).toHaveLength(1);
    expect(r.elements[0]).toMatchObject({
      id: els[0].id,
      type: "rectangle",
      x: 1,
      y: 2,
      width: 30,
      height: 40,
    });
    expect(r.elements[0]).not.toHaveProperty("version");
    expect(Object.isFrozen(r.elements)).toBe(true);
    await expect(
      ctx.vault.readDrawing("nope.excalidraw"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("createDrawing builds elements, writes create-only and returns ids", async () => {
    await bootVault(["vault.read", "vault.write"]);
    const made = await ctx.vault.createDrawing("new/n.excalidraw", [
      { op: "add", element: { type: "text", text: "hi", x: 5, y: 6 } },
      { op: "add", element: { ...rect, text: "label" } },
    ]);
    expect(made.path).toBe("new/n.excalidraw");
    expect(made.ids).toHaveLength(2);
    const backend = getPluginsBackend() as ReturnType<typeof createFakeBackend>;
    const stored = backend.drawings["new/n.excalidraw"].scene as {
      type: string;
      elements: unknown[];
    };
    expect(stored.type).toBe("excalidraw");
    expect(stored.elements.length).toBe(3); // text, rectangle and its bound label
    const back = await ctx.vault.readDrawing("new/n.excalidraw");
    expect(
      back.elements.some((e) => e.type === "text" && e.text === "hi"),
    ).toBe(true);
    const write = backend.gatewayCalls.find((c) => c.method === "file.write")!;
    expect(
      (write.params as { expectedRevision: unknown }).expectedRevision,
    ).toBeNull();
    await expect(
      ctx.vault.createDrawing("new/n.excalidraw", []),
    ).rejects.toMatchObject({ code: "NAME_COLLISION" });
  });

  it("createDrawing refuses ops that need existing elements", async () => {
    await bootVault(["vault.write"]);
    await expect(
      ctx.vault.createDrawing("a.excalidraw", [{ op: "delete", id: "x" }]),
    ).rejects.toThrow(/op 0/);
  });

  it("a read-only vault refuses createDrawing with the app's code", async () => {
    await bootVault(["vault.write"]);
    (
      getPluginsBackend() as ReturnType<typeof createFakeBackend>
    ).vaultReadOnly = true;
    await expect(
      ctx.vault.createDrawing("a.excalidraw", []),
    ).rejects.toMatchObject({ code: "READ_ONLY" });
  });
});

describe("vault.changed gate", () => {
  it("without vault.read it reports PERMISSION and returns a no-op disposable", async () => {
    const cb = vi.fn();
    await bootVault([], (c) => {
      const d = c.events.on("vault.changed", cb);
      expect(() => d.dispose()).not.toThrow();
    });
    await t!.flush();
    expect(appEvents.hasListeners("vault.changed")).toBe(false);
    expect(
      t!
        .log()
        .map((l) => l.text)
        .join("\n"),
    ).toMatch(
      /events\.on: vp: vault\.changed needs the permission "vault\.read"/,
    );
  });

  it("with vault.read it delivers the event", async () => {
    const cb = vi.fn();
    await bootVault(
      ["vault.read"],
      (c) => void c.events.on("vault.changed", cb),
    );
    expect(appEvents.hasListeners("vault.changed")).toBe(true);
    t!.events.emit("vault.changed", { paths: ["a.excalidraw"], rescan: false });
    await t!.flush();
    expect(cb).toHaveBeenCalledWith({ paths: ["a.excalidraw"], rescan: false });
  });

  it("stops delivering when an update removes vault.read", async () => {
    const cb = vi.fn();
    await bootVault(
      ["vault.read"],
      (c) => void c.events.on("vault.changed", cb),
    );
    getRuntime("vp")!.info = { ...getRuntime("vp")!.info, permissions: [] };
    t!.events.emit("vault.changed", { paths: ["a.excalidraw"], rescan: false });
    await t!.flush();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("ctx.workspace", () => {
  it("open: NOT_FOUND for a missing drawing, then opens, with newTab", async () => {
    await bootVault([]);
    await expect(
      ctx.workspace.open("missing.excalidraw"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    t!.vault.seed({ "a.excalidraw": [rect] });
    await ctx.workspace.open("a.excalidraw");
    await ctx.workspace.open("a.excalidraw", { newTab: true });
    expect(t!.workspace.opened()).toEqual([
      { path: "a.excalidraw", newTab: false },
      { path: "a.excalidraw", newTab: true },
    ]);
    expect(ctx.workspace.activePath()).toBe("a.excalidraw");
  });

  it("open: INVALID_PATH, NO_VAULT and IO_ERROR", async () => {
    await bootVault([]);
    await expect(ctx.workspace.open("a.txt")).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
    t!.vault.setVault(null);
    await expect(ctx.workspace.open("a.excalidraw")).rejects.toMatchObject({
      code: "NO_VAULT",
    });
    setWorkspaceBridge({
      vault: () => ({ name: "v", readOnly: false }),
      activePath: () => null,
      drawingExists: async () => true,
      openDrawing: async () => false,
    });
    await expect(ctx.workspace.open("a.excalidraw")).rejects.toMatchObject({
      code: "IO_ERROR",
    });
    expect(ctx.workspace.activePath()).toBeNull();
  });
});

describe("lazy getters", () => {
  it("build nothing until read", async () => {
    const mod = await import("./vaultContext");
    const spy = vi.mocked(mod.createVaultApi);
    spy.mockClear();
    await bootVault([]);
    expect(spy).not.toHaveBeenCalled();
    expect(ctx.vault).toBe(ctx.vault);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
