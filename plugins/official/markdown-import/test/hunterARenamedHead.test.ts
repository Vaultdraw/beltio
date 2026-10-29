/**
 * Hunter A round 2 (A-5): "Re-import unchanged imported notes" on a long note whose first drawing
 * the user renamed, moved or deleted. The other parts still name the note, so the run rebuilt the
 * note and wrote its first drawing back under the old name (replaceDrawing creates a missing
 * path): the user's rename was undone by a duplicate. Obsidian never recreates a deleted note.
 */
import { describe, expect, test, vi } from "vitest";

import { forgetSource, reimport } from "../src/reimport";

import type { PluginContext } from "@vaultdraw/api";

vi.mock("../src/deps", () => ({
  importObsidianVault: async ({
    target,
  }: {
    target: { writeDrawing(p: string, s: object): Promise<void> };
  }) => {
    await target.writeDrawing("Long.excalidraw", {});
    await target.writeDrawing("Long (part 2).excalidraw", {});
  },
}));
vi.mock("../src/obsidian/plan", () => ({
  planImport: () => ({
    items: [{ kind: "note", target: "Long.excalidraw", path: "Long.md" }],
  }),
}));
vi.mock("../src/settings", () => ({ readSettings: () => ({}) }));
vi.mock("../src/webImages", () => ({ createWebImages: () => ({}) }));

describe("re-import: a note whose first drawing is gone", () => {
  test("a vault-wide run does not create the missing first drawing again", async () => {
    forgetSource();
    const existing = new Set([
      "Vault/Long (part 2).excalidraw",
      "Vault/Renamed.excalidraw",
    ]);
    const created: string[] = [];
    const ctx = {
      host: { has: () => false },
      folders: {
        pickSource: async () => ({ name: "Obs", list: async () => [] }),
      },
      ui: { toast() {} },
      vault: {
        async replaceDrawing(path: string) {
          if (!existing.has(path)) {
            created.push(path);
            return { revision: "r", created: true };
          }
          return { revision: "r" };
        },
      },
    } as unknown as PluginContext;
    await reimport(
      ctx,
      ["Vault/Long (part 2).excalidraw", "Vault/Renamed.excalidraw"],
      true,
    );
    expect(created).toEqual([]);
  });
});
