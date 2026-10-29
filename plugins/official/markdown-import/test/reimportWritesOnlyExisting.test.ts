/**
 * Family (hunter A-6, CTO rule): a re-import writes only drawings that exist. A part the user
 * deleted, renamed or moved is never written back; a run over unchanged notes creates nothing
 * (a longer note is named instead); "Re-import from its Markdown" on one note may add parts after
 * the last one.
 */
import { describe, expect, test, vi } from "vitest";

import { forgetSource, reimport } from "../src/reimport";

import type { PluginContext } from "@vaultdraw/api";

let parts = 2;
vi.mock("../src/deps", () => ({
  importObsidianVault: async ({
    target,
  }: {
    target: { writeDrawing(p: string, s: object): Promise<void> };
  }) => {
    for (let n = 1; n <= parts; n++) {
      await target.writeDrawing(
        n === 1 ? "Long.excalidraw" : `Long (part ${n}).excalidraw`,
        {},
      );
    }
  },
}));
vi.mock("../src/obsidian/plan", () => ({
  planImport: () => ({
    items: [{ kind: "note", target: "Long.excalidraw", path: "Long.md" }],
  }),
}));
vi.mock("../src/settings", () => ({ readSettings: () => ({}) }));
vi.mock("../src/webImages", () => ({
  createWebImages: () => ({ downloaded: 0, async fill() {} }),
}));

const P = (n: number) =>
  n === 1 ? "V/Long.excalidraw" : `V/Long (part ${n}).excalidraw`;

const run = async (have: number[], built: number, bulk: boolean) => {
  forgetSource();
  parts = built;
  const existing = new Set(have.map(P));
  const created: string[] = [];
  const written: string[] = [];
  const ctx = {
    host: { has: () => false },
    folders: {
      pickSource: async () => ({ name: "Obs", list: async () => [] }),
    },
    ui: { toast() {} },
    menus: { target: () => null },
    vault: {
      async list() {
        return [...existing].map((path) => ({ kind: "drawing", path }));
      },
      async replaceDrawing(path: string) {
        (existing.has(path) ? written : created).push(path);
        return { revision: "r" };
      },
    },
  } as unknown as PluginContext;
  const chosen = bulk ? [...existing] : [have.length ? P(have[0]) : P(1)];
  await reimport(ctx, chosen, bulk);
  return { created, written };
};

describe("re-import writes only drawings that exist", () => {
  test.each([
    // [case, parts on disk, parts the note makes now, bulk run, created, writes anything]
    ["same length", [1, 2], 2, true, [], true],
    ["first part deleted or renamed", [2], 2, true, [], false],
    ["middle part deleted", [1, 3], 3, true, [], false],
    ["last part deleted", [1, 2], 3, true, [], false],
    ["the note grew (bulk)", [1], 2, true, [], false],
    ["the note grew (one note, chosen)", [1], 2, false, [P(2)], true],
    ["first part gone (one note, chosen)", [2], 2, false, [], false],
  ] as const)("%s", async (_, have, built, bulk, created, writes) => {
    const out = await run([...have], built, bulk);
    expect(out.created).toEqual(created);
    expect(out.written.length > 0).toBe(writes);
  });
});
