import { describe, expect, it } from "vitest";

import {
  createFakeBackend,
  readThroughVault,
} from "../plugins/host/fakeBackend";

import { FakeVaultRepository } from "./fakeVaultRepository";

import type { PluginInfo } from "../plugins/host/types";

/**
 * Twin (bug utilizer, 2026-10-30): the plugin host's fake backend kept its own file list, so a
 * rename in the file tree never reached plugins in the browser harness while the native gateway
 * reads the vault. Wired with `readThroughVault` (as the e2e harness is), the plugin vault rows
 * see every change the app's vault makes.
 */
const EMPTY = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "t",
  elements: [],
  appState: {},
  files: {},
});

const reader = {
  id: "reader",
  permissions: ["vault.read"],
} as unknown as PluginInfo;

const setup = () => {
  const repo = new FakeVaultRepository();
  repo.seedDrawing("A.excalidraw", EMPTY);
  repo.seedDrawing("Notes/B.excalidraw", EMPTY);
  const fake = createFakeBackend([reader]);
  readThroughVault(fake, () => repo);
  const call = (method: string, params: object) =>
    fake.pluginCall!("reader", method, params as never);
  const names = async (dir = "") =>
    (
      (await call("vault.list", { dir })) as { entries: { path: string }[] }
    ).entries
      .map((e) => e.path)
      .sort();
  return { repo, call, names };
};

describe("plugin vault rows read the app's vault", () => {
  it.each([
    [
      "rename a drawing",
      (r: FakeVaultRepository) =>
        r.move(r.handle, "A.excalidraw", "A2.excalidraw"),
      ["A2.excalidraw", "Notes"],
      "A.excalidraw",
    ],
    [
      "move a drawing into a folder",
      (r: FakeVaultRepository) =>
        r.move(r.handle, "A.excalidraw", "Notes/A.excalidraw"),
      ["Notes"],
      "A.excalidraw",
    ],
    [
      "rename a folder",
      (r: FakeVaultRepository) => r.move(r.handle, "Notes", "Ideas"),
      ["A.excalidraw", "Ideas"],
      "Notes/B.excalidraw",
    ],
  ] as const)("%s", async (_, change, root, gone) => {
    const { repo, call, names } = setup();
    await change(repo);
    expect(await names()).toEqual(root);
    await expect(call("file.read", { path: gone })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("a drawing added in the app is readable by plugins", async () => {
    const { repo, call } = setup();
    repo.seedDrawing("New.excalidraw", EMPTY);
    await expect(
      call("file.read", { path: "New.excalidraw" }),
    ).resolves.toMatchObject({
      path: "New.excalidraw",
    });
  });
});

describe("guard: every e2e harness wires the plugin backend through the vault", () => {
  it("each file that creates a fake backend also calls readThroughVault", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");
    const dir = resolve(__dirname, "../../e2e");
    const missing = readdirSync(dir)
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => {
        const text = readFileSync(join(dir, f), "utf8");
        return (
          text.includes("createFakeBackend(") &&
          !text.includes("readThroughVault(")
        );
      });
    expect(missing).toEqual([]);
  });
});
