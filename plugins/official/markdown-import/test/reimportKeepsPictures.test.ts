/**
 * Hunter A-8 family: "a re-import never trades a picture the drawing holds for a box". When web
 * pictures cannot be downloaded now (Offline mode, no connection) and the note's drawing already
 * holds pictures, the note is left as it was and named; permanent failures (a web page, not a
 * picture) and drawings without pictures are written as before.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

import { forgetSource, reimport } from "../src/reimport";

import type { PluginContext } from "@vaultdraw/api";

let fillAlt: string | null = null;

vi.mock("../src/deps", () => ({
  importObsidianVault: async ({
    target,
    web,
  }: {
    target: { writeDrawing(p: string, s: object): Promise<void> };
    web: { fill(items: object[]): Promise<void> };
  }) => {
    const item = { type: "image", target: "https://a.example/p.png", alt: "p" };
    await web.fill([item]);
    if (fillAlt !== null) {
      item.alt = fillAlt;
    }
    await target.writeDrawing("Note.excalidraw", {});
  },
}));
vi.mock("../src/obsidian/plan", () => ({
  planImport: () => ({
    items: [{ kind: "note", target: "Note.excalidraw", path: "Note.md" }],
  }),
}));
vi.mock("../src/settings", () => ({ readSettings: () => ({}) }));
vi.mock("../src/webImages", () => ({
  createWebImages: () => ({
    downloaded: 0,
    async fill(items: { alt: string; bytes?: Uint8Array }[]) {
      for (const i of items) {
        if (fillAlt === null) {
          i.bytes = new Uint8Array([1]);
        } else {
          i.alt = fillAlt;
        }
      }
    },
  }),
}));

const run = async (hasPicture: boolean) => {
  forgetSource();
  const written: string[] = [];
  const ctx = {
    host: { has: () => false },
    folders: {
      pickSource: async () => ({ name: "Obs", list: async () => [] }),
    },
    ui: { toast() {} },
    vault: {
      async list() {
        return [{ kind: "drawing", path: "Note.excalidraw" }];
      },
      async readDrawing() {
        return {
          elements: hasPicture ? [{ type: "image" }] : [{ type: "text" }],
        };
      },
      async replaceDrawing(path: string) {
        written.push(path);
        return { revision: "r" };
      },
    },
  } as unknown as PluginContext;
  const s = await reimport(ctx, ["Note.excalidraw"], true);
  return { written, kept: s!.keptPictures };
};

describe("re-import keeps pictures it cannot download again", () => {
  beforeEach(() => {
    fillAlt = null;
  });

  test.each([
    [
      "Offline mode on, the drawing has pictures",
      "Web image, not downloaded (Offline mode is on): p",
      true,
      false,
    ],
    [
      "no connection, the drawing has pictures",
      "Web image could not be downloaded: p",
      true,
      false,
    ],
    [
      "web pictures off in Settings, pictures held",
      "Web image, not downloaded (web pictures are off in Settings): p",
      true,
      false,
    ],
    [
      "Offline mode on, the drawing has no pictures",
      "Web image, not downloaded (Offline mode is on): p",
      false,
      true,
    ],
    [
      "a web page, not a picture (stays broken)",
      "Web page, not a picture: p",
      true,
      true,
    ],
    ["downloaded fine", null, true, true],
  ] as const)("%s", async (_, alt, hasPicture, writes) => {
    fillAlt = alt;
    const { written, kept } = await run(hasPicture);
    expect(written.length > 0).toBe(writes);
    expect(kept.length > 0).toBe(!writes);
  });
});
