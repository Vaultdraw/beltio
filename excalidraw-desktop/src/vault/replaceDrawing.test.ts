import { describe, expect, it, vi } from "vitest";

import { replaceDrawing } from "./replaceDrawing";

import type { ReplaceDeps } from "./replaceDrawing";

const scene = (created: number[], extra: object[] = []) =>
  JSON.stringify({
    elements: [
      ...created.map((c, i) => ({ id: `e${i}`, type: "text", created: c })),
      ...extra,
    ],
  });

function deps(files: Record<string, string>, o: { noVersion?: boolean } = {}) {
  const log: string[] = [];
  const d: ReplaceDeps = {
    handle: "h",
    repository: {
      readDrawing: async (_h, path) => {
        if (!(path in files)) {
          throw Object.assign(new Error("gone"), { code: "NOT_FOUND" });
        }
        return {
          json: files[path],
          revision: `r-${path}`,
          readOnly: false,
        } as never;
      },
      writeDrawing: async ({ path, json, expectedRevision }) => {
        expect(expectedRevision).toBe(`r-${path}`);
        log.push(`write ${path}`);
        files[path] = json;
        return { revision: "r2" } as never;
      },
    },
    history: {
      checkpoint: vi.fn(async (_h: string, path: string, name: string) => {
        if (o.noVersion) {
          throw new Error("off");
        }
        log.push(`version ${path} ${name}`);
        return {} as never;
      }),
    },
    flush: async (p) => void log.push(`flush ${p}`),
    reload: async (p) => void log.push(`reload ${p}`),
    create: async (p, j) => {
      files[p] = j;
      log.push(`create ${p}`);
      return "r1";
    },
  };
  return { d, log, files };
}

describe("replaceDrawing", () => {
  it("saves pending edits, keeps the old drawing in History, then writes and reloads", async () => {
    const { d, log, files } = deps({ "a.excalidraw": scene([1, 1]) });
    const r = await replaceDrawing(d, "a.excalidraw", "NEW", {
      versionName: "Before",
    });
    expect(r).toEqual({ revision: "r2" });
    expect(log).toEqual([
      "flush a.excalidraw",
      "version a.excalidraw Before",
      "write a.excalidraw",
      "reload a.excalidraw",
    ]);
    expect(files["a.excalidraw"]).toBe("NEW");
  });

  it("writes nothing when no History version could be saved", async () => {
    const { d, files } = deps(
      { "a.excalidraw": scene([1]) },
      { noVersion: true },
    );
    await expect(
      replaceDrawing(d, "a.excalidraw", "NEW", { versionName: "x" }),
    ).rejects.toMatchObject({ code: "NO_VERSION" });
    expect(files["a.excalidraw"]).toBe(scene([1]));
  });

  it("onlyIfUntouched leaves an edited drawing alone; filled web pictures are not edits", async () => {
    const edited = scene([1, 2]);
    const filled = scene(
      [1, 1],
      [{ id: "p", type: "image", created: 9, link: "https://x/y.png" }],
    );
    const { d, files } = deps({
      "e.excalidraw": edited,
      "f.excalidraw": filled,
    });
    expect(
      await replaceDrawing(d, "e.excalidraw", "NEW", {
        versionName: "x",
        onlyIfUntouched: true,
      }),
    ).toEqual({ skipped: "changed" });
    expect(files["e.excalidraw"]).toBe(edited);
    expect(
      await replaceDrawing(d, "f.excalidraw", "NEW", {
        versionName: "x",
        onlyIfUntouched: true,
      }),
    ).toEqual({ revision: "r2" });
  });

  it("a missing drawing is created, with no version", async () => {
    const { d, log } = deps({});
    expect(
      await replaceDrawing(d, "n.excalidraw", "NEW", { versionName: "x" }),
    ).toEqual({ revision: "r1", created: true });
    expect(log).toEqual(["flush n.excalidraw", "create n.excalidraw"]);
  });
});
