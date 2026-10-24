import { afterEach, describe, expect, it, vi } from "vitest";

import {
  findImporter,
  hasImporters,
  importerExtensions,
  runImports,
  setImporterOverrides,
} from "./importerMap";
import {
  claimImporter,
  importerClashes,
  resetImporterMap,
  setImportRunner,
  subscribeImporters,
} from "./importerMapAdmin";

const entry = (pluginId: string, importerId = "i", title = "T") => ({
  pluginId,
  importerId,
  title,
});

afterEach(() => resetImporterMap());

describe("importerMap", () => {
  it("is empty and free by default", () => {
    expect(hasImporters()).toBe(false);
    expect(findImporter("a.txt")).toBeNull();
  });

  it("claims, finds case-insensitively and disposes", () => {
    const off = claimImporter(entry("text"), ["TXT"]);
    expect(findImporter("Notes.TXT")).toMatchObject({
      pluginId: "text",
      extension: "txt",
    });
    expect(findImporter("txt")).toBeNull();
    expect(importerExtensions()).toEqual(["txt"]);
    off();
    off();
    expect(hasImporters()).toBe(false);
  });

  it("prefers the longest suffix", () => {
    claimImporter(entry("md"), ["md"]);
    claimImporter(entry("exmd"), ["excalidraw.md"]);
    expect(findImporter("a.b.excalidraw.md")?.pluginId).toBe("exmd");
    expect(findImporter("a.md")?.pluginId).toBe("md");
  });

  it("settles clashes by sort order, then by the config key", () => {
    claimImporter(entry("zeta"), ["txt"]);
    claimImporter(entry("alpha"), ["txt"]);
    expect(findImporter("a.txt")?.pluginId).toBe("alpha");
    expect(importerClashes()).toEqual([
      {
        extension: "txt",
        winner: entry("alpha"),
        others: [entry("zeta")],
      },
    ]);
    setImporterOverrides({ ".TXT": "zeta" });
    expect(findImporter("a.txt")?.pluginId).toBe("zeta");
    setImporterOverrides({ txt: "missing" });
    expect(findImporter("a.txt")?.pluginId).toBe("alpha");
    setImporterOverrides({ txt: "" });
    expect(findImporter("a.txt")).toBeNull();
    expect(importerClashes()[0].winner).toBeNull();
  });

  it("reports a config choice that does not import the extension", () => {
    claimImporter(entry("alpha"), ["txt"]);
    setImporterOverrides({ txt: "typo" });
    expect(findImporter("a.txt")?.pluginId).toBe("alpha");
    expect(importerClashes()).toEqual([
      {
        extension: "txt",
        winner: entry("alpha"),
        others: [],
        unknownChoice: "typo",
      },
    ]);
  });

  it("notifies subscribers", () => {
    const fn = vi.fn();
    const off = subscribeImporters(fn);
    claimImporter(entry("x"), ["txt"]);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
  });

  it("runs imports only with a runner", async () => {
    claimImporter(entry("x"), ["txt"]);
    const file = new File(["hi"], "a.txt");
    const item = { file, match: findImporter("a.txt")! };
    const target = { path: "a.excalidraw", at: { x: 1, y: 2 } };
    expect(await runImports([item], target)).toBe(false);
    const run = vi.fn(async () => {});
    setImportRunner(run);
    expect(await runImports([item], target)).toBe(true);
    expect(run).toHaveBeenCalledWith([item], target);
  });

  it("finds a miss in well under 0.05 ms", () => {
    claimImporter(entry("x"), ["txt"]);
    const n = 20000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      findImporter("photo.png");
    }
    expect((performance.now() - t0) / n).toBeLessThan(0.05);
  });
});
