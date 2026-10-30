/**
 * Hunter M (2026-10-30 night), toimprove M-13: the `create` member of hunter K-1's family
 * ("every way a path becomes a file target assumes a native drawing"). The fix for K-1
 * (a501f692) moved `open` to `openablePath`; `new` still runs `withExt(plan.path)`
 * (`uriRun.ts` ~415). docs/uri-scheme.md: `vaultdraw://new?path=…` "Creates the drawing and opens
 * it. If it exists, it is just opened. It never overwrites." For an existing Obsidian drawing
 * (`Sketch.excalidraw.md`) or note the link instead creates `Sketch.excalidraw.md.excalidraw` /
 * `Plan.md.excalidraw` (a stray file with a double extension) and opens that.
 */
import { describe, expect, it } from "vitest";

import { ControlError } from "../control/errors";
import { createUriRunner, type UriDeps } from "../control/uriRun";

const files = [
  "Graphs/BFS.excalidraw",
  "Notes/Plan.md",
  "Obsidian/Sketch.excalidraw.md",
];

const runner = () => {
  const opened: string[] = [];
  const created: string[] = [];
  const deps: UriDeps = {
    call: async (method, params) => {
      const p = params as { path: string };
      if (method === "file.open") {
        if (!files.includes(p.path) && !created.includes(p.path)) {
          throw new ControlError("NOT_FOUND", `No such drawing ${p.path}`);
        }
        opened.push(p.path);
        return { path: p.path, opened: true };
      }
      if (method === "file.create") {
        created.push(p.path);
      }
      return {};
    },
    vault: () => ({ name: "DSA", path: "/v/DSA" }),
    recentVaults: () => ["/v/DSA"],
    commandTitle: () => null,
    isBuiltin: () => true,
    isLinkable: () => false,
    openSearch: () => {},
    readExternal: async () => ({ name: "", json: "{}" }),
    exists: async (p) => files.includes(p),
    addLibrary: async () => {},
    canAddVaultLibrary: () => false,
    ask: () => {},
    notify: () => {},
    sleep: async () => {},
  };
  return { run: createUriRunner(deps).run, opened, created };
};

describe("vaultdraw://new on a file that exists only opens it (toimprove M-13)", () => {
  it("sanity: an existing drawing, with or without the extension, is only opened", async () => {
    const r = runner();
    await r.run({ action: "new", path: "Graphs/BFS", allowed: true });
    await r.run({
      action: "new",
      path: "Graphs/BFS.excalidraw",
      allowed: true,
    });
    expect(r.created).toEqual([]);
    expect(r.opened).toEqual([
      "Graphs/BFS.excalidraw",
      "Graphs/BFS.excalidraw",
    ]);
  });

  it.fails.each([["Obsidian/Sketch.excalidraw.md"], ["Notes/Plan.md"]])(
    "new?path=%s opens it and creates nothing",
    async (path) => {
      const r = runner();
      await r.run({ action: "new", path, allowed: true }).catch(() => {});
      expect(r.created).toEqual([]);
      expect(r.opened).toEqual([path]);
    },
  );
});
