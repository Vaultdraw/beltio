/**
 * Family hunter shell (2026-10-31), "every path that becomes a file target opens notes and
 * Obsidian drawings as written" (K-1 toimprove 206, M-13 toimprove 265 fixed the link runner and
 * `vaultdraw://new`). The command line is another member: a path handed to a running
 * app by a second launch (`vaultdraw launch ~/vault/Notes/Plan.md`, an "Open with" on Linux) is
 * routed to `app.openTarget` (`control/dispatch.rs` `Route::Path`), unlike `vaultdraw open`, which
 * uses `file.open` and works. `app.openTarget` asks the window to resolve the path, and the window only accepts a path when it is a *drawing* in the file
 * list (`kind === "drawing"`) or, before the list exists, ends in `.excalidraw`. A note or an
 * Obsidian drawing in the vault answers "Cannot open ...". Obsidian's `obsidian open path=` and
 * Neovim (`nvim file`) open any file they are given.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveOpenTarget } from "../control/openTarget";

const app = readFileSync(join(__dirname, "..", "VaultApp.tsx"), "utf8");
const at = app.indexOf("openTarget: async (target, cwd)");
const block = app.slice(at, app.indexOf("appLinks.openLink(path)", at));

describe("family (shell hunter): the command line opens any file of the vault", () => {
  it("sanity: the resolver itself accepts whatever the window says exists", () => {
    const has = (p: string) =>
      ["Notes/Plan.md", "Obsidian/Sketch.excalidraw.md"].includes(p);
    expect(resolveOpenTarget("/v/Notes/Plan.md", "/", "/v", has)).toBe(
      "Notes/Plan.md",
    );
    expect(
      resolveOpenTarget("/v/Obsidian/Sketch.excalidraw.md", "/", "/v", has),
    ).toBe("Obsidian/Sketch.excalidraw.md");
  });

  it("sanity: the window's openTarget block was found", () => {
    expect(at).toBeGreaterThan(0);
    expect(block).toContain("resolveOpenTarget");
  });

  it.fails(
    "app.openTarget accepts a note or an Obsidian drawing, not only .excalidraw drawings (toimprove 306)",
    () => {
      expect(block).not.toMatch(/kind === "drawing"/);
      expect(block).not.toMatch(/endsWith\("\.excalidraw"\)/);
    },
  );
});
