import { describe, expect, it, vi } from "vitest";

import { runImportUpgrade } from "./runUpgrade";

import type { UpgradeDeps } from "./runUpgrade";
import type { VaultEntry } from "../vault/types";

const MARK = { "plugins.markdown-import": { heading: 1 } };
const oldImport = JSON.stringify({
  type: "excalidraw",
  appState: { pageSetup: { enabled: true, paperTheme: "normal" } },
  elements: [{ id: "h", type: "text", fontFamily: 5, customData: MARK }],
});
const mine = JSON.stringify({
  type: "excalidraw",
  appState: { pageSetup: { enabled: true, paperTheme: "normal" } },
  elements: [{ id: "t", type: "text", fontFamily: 5 }],
});

const entry = (path: string, kind: VaultEntry["kind"]): VaultEntry => ({
  path,
  name: path.split("/").pop()!,
  kind,
  modifiedAt: 0,
  size: 1,
});

function vault(
  files: Record<string, string>,
  opts: { failVersion?: string; conflict?: string } = {},
) {
  const writes: string[] = [];
  const versions: string[] = [];
  const deps: UpgradeDeps = {
    handle: "h",
    target: {
      look: {
        paperTheme: "match",
        viewBackgroundColor: "#111111",
        viewBackgroundPattern: null,
      },
      fontFamily: 3,
    },
    repository: {
      listDirectory: async (_h, dir) => {
        const prefix = dir ? `${dir}/` : "";
        const names = new Map<string, VaultEntry>();
        for (const p of Object.keys(files).filter((f) =>
          f.startsWith(prefix),
        )) {
          const rest = p.slice(prefix.length).split("/");
          const path = prefix + rest[0];
          names.set(path, entry(path, rest.length > 1 ? "folder" : "drawing"));
        }
        return [...names.values()];
      },
      readDrawing: async (_h, path) => ({
        json: files[path],
        revision: `r-${path}`,
      }),
      writeDrawing: async ({ path, json, expectedRevision }) => {
        if (path === opts.conflict || expectedRevision !== `r-${path}`) {
          throw Object.assign(new Error("changed"), { code: "CONFLICT" });
        }
        files[path] = json;
        writes.push(path);
        return { revision: "r2" };
      },
    },
    history: {
      checkpoint: vi.fn(async (_h: string, path: string) => {
        if (path === opts.failVersion) {
          throw new Error("history off");
        }
        versions.push(path);
        return { id: path } as never;
      }),
    },
  };
  return { deps, files, writes, versions };
}

describe("runImportUpgrade", () => {
  it("rewrites only old imports, in every folder, each after a history version", async () => {
    const v = vault({
      "Obsidian/A.excalidraw": oldImport,
      "Obsidian/Deep/B.excalidraw": oldImport,
      "Mine.excalidraw": mine,
    });
    const s = await runImportUpgrade(v.deps);
    expect(s).toMatchObject({ scanned: 3, updated: 2, skipped: 0 });
    expect(v.writes.sort()).toEqual([
      "Obsidian/A.excalidraw",
      "Obsidian/Deep/B.excalidraw",
    ]);
    expect(v.versions.sort()).toEqual(v.writes.sort());
    expect(v.files["Mine.excalidraw"]).toBe(mine);
    expect(
      JSON.parse(v.files["Obsidian/A.excalidraw"]).elements[0].fontFamily,
    ).toBe(3);
    // A second run finds nothing left to do.
    expect((await runImportUpgrade(v.deps)).updated).toBe(0);
  });

  it("never writes a file whose history version failed, nor one changed meanwhile", async () => {
    const v = vault(
      { "A.excalidraw": oldImport, "B.excalidraw": oldImport },
      { failVersion: "A.excalidraw", conflict: "B.excalidraw" },
    );
    const s = await runImportUpgrade(v.deps);
    expect(s).toMatchObject({ updated: 0, skipped: 2 });
    expect(v.files["A.excalidraw"]).toBe(oldImport);
    expect(v.files["B.excalidraw"]).toBe(oldImport);
  });

  it("a folder run touches only that folder and its subfolders", async () => {
    const v = vault({
      "Obsidian/A.excalidraw": oldImport,
      "Obsidian/Deep/B.excalidraw": oldImport,
      "Other/C.excalidraw": oldImport,
    });
    const s = await runImportUpgrade({ ...v.deps, folder: "Obsidian" });
    expect(s).toMatchObject({ scanned: 2, updated: 2 });
    expect(v.files["Other/C.excalidraw"]).toBe(oldImport);
  });
});
