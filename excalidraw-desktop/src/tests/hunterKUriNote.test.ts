/**
 * Hunter K (2026-10-30), K-1: the row menu's "Copy path > Vaultdraw link" on a note or an
 * Obsidian drawing copies `vaultdraw://open?file=Notes/Plan.md`, but opening that link (from
 * another app, or the palette's "Links: Open a vaultdraw:// link…") adds `.excalidraw` to the
 * path (`uriRun.ts` `withExt`), so the window asks for `Notes/Plan.md.excalidraw` and says
 * "No such drawing". `file.open` itself opens notes (probeExists lists the folder for them).
 * Obsidian's "Copy Obsidian URL" works for every file it lists.
 */
import { describe, expect, it } from "vitest";

import { encodeVaultUrl } from "../links/linkUri";
import { pathText } from "../components/menu/copyPath";
import { ControlError } from "../control/errors";
import { createUriRunner, type UriDeps } from "../control/uriRun";

const files = [
  "Graphs/BFS.excalidraw",
  "Notes/Plan.md",
  "Obsidian/Sketch.excalidraw.md",
];

const runner = () => {
  const opened: string[] = [];
  const errors: string[] = [];
  const deps: UriDeps = {
    call: async (method, params) => {
      const p = params as { path: string };
      if (method === "file.open") {
        if (!files.includes(p.path)) {
          throw new ControlError("NOT_FOUND", `No such drawing ${p.path}`);
        }
        opened.push(p.path);
        return { path: p.path, opened: true };
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
    notify: (m, k) => {
      if (k === "error") {
        errors.push(m);
      }
    },
    sleep: async () => {},
  };
  return { run: createUriRunner(deps).run, opened, errors };
};

/** What the Rust side hands the window for `vaultdraw://open?file=<path>` (file as written). */
const openPlan = (link: string) => {
  const file = decodeURIComponent(link.split("file=")[1]);
  return { action: "open" as const, file };
};

describe("hunter K-1: a copied Vaultdraw link opens the file it was copied from", () => {
  it("sanity: a drawing's copied link opens the drawing (extension optional)", async () => {
    const r = runner();
    const link = pathText("link", "Graphs/BFS.excalidraw", "/v/DSA");
    await r.run(openPlan(link));
    await r.run({ action: "open", file: "Graphs/BFS" });
    expect(r.opened).toEqual([
      "Graphs/BFS.excalidraw",
      "Graphs/BFS.excalidraw",
    ]);
  });

  it.fails.each([["Notes/Plan.md"], ["Obsidian/Sketch.excalidraw.md"]])(
    "toimprove 206: the copied link of %s opens it",
    async (path) => {
      const r = runner();
      const link = pathText("link", path, "/v/DSA");
      expect(link).toBe(encodeVaultUrl(path));
      await r.run(openPlan(link)).catch(() => {});
      expect(r.errors).toEqual([]);
      expect(r.opened).toEqual([path]);
    },
  );
});
