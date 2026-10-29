import { describe, expect, it, vi } from "vitest";

import { stampElements } from "../importUpgrade/stamp";

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

  it("onlyIfUntouched: edited is left alone, filled pictures are not edits, unstamped is unknown", async () => {
    const stamped = (edit?: (els: Record<string, any>[]) => void) => {
      const els: Record<string, any>[] = [
        { id: "t", type: "text", x: 40, y: 40, originalText: "a" },
        { id: "b", type: "rectangle", x: 40, y: 80, link: "https://x/y.png" },
        { id: "l", type: "text", x: 48, y: 88, originalText: "Web image" },
      ];
      stampElements(els);
      edit?.(els);
      return JSON.stringify({ elements: els });
    };
    const edited = stamped((els) => (els[0].x = 99));
    const filled = stamped((els) =>
      els.splice(1, 2, { id: "p", type: "image", link: "https://x/y.png" }),
    );
    const { d, files } = deps({
      "e.excalidraw": edited,
      "f.excalidraw": filled,
      "u.excalidraw": scene([1, 1]),
    });
    const only = { versionName: "x", onlyIfUntouched: true };
    expect(await replaceDrawing(d, "e.excalidraw", "NEW", only)).toEqual({
      skipped: "changed",
    });
    expect(files["e.excalidraw"]).toBe(edited);
    expect(await replaceDrawing(d, "u.excalidraw", "NEW", only)).toEqual({
      skipped: "unknown",
    });
    expect(await replaceDrawing(d, "f.excalidraw", "NEW", only)).toEqual({
      revision: "r2",
    });
  });

  it("a missing drawing is created, with no version", async () => {
    const { d, log } = deps({});
    expect(
      await replaceDrawing(d, "n.excalidraw", "NEW", { versionName: "x" }),
    ).toEqual({ revision: "r1", created: true });
    expect(log).toEqual(["flush n.excalidraw", "create n.excalidraw"]);
  });
});
