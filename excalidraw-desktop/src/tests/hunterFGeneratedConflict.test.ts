import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { uniqueName } from "../vault/uniqueName";

/**
 * Hunter F-14 (2026-10-30). The app's own next-free-name rule gives "Untitled", "Untitled 1",
 * "Untitled 2" (Obsidian does the same; also "x copy 2" from Duplicate). The native listing
 * (`vaultdraw-core/src/drawing.rs:71`, `sync_names::numbered_copy_original`) flags every file called
 * "<name> 2" .. "<name> 99" as an iCloud conflict copy of "<name>" whenever "<name>" exists beside
 * it, with no check that the vault is on a sync service. The third new drawing in a folder
 * therefore shows a "conflict" badge and a "Compare with original" menu item. (The browser stand-in flags it the
 * same way, and generated-names.spec.ts creates "Untitled 2" but only checks file names.)
 */
describe("hunter F-14: the app's own generated names are not sync conflicts", () => {
  const sync = readFileSync(
    resolve(
      __dirname,
      "../../src-tauri/crates/vaultdraw-core/src/sync_names.rs",
    ),
    "utf8",
  );

  it("(context) the generator's third name is 'Untitled 2'", () => {
    const taken = ["Untitled.excalidraw", "Untitled 1.excalidraw"];
    expect(uniqueName("Untitled", ".excalidraw", taken)).toBe(
      "Untitled 2.excalidraw",
    );
  });

  it("(context) the native rule flags '<name> 2' when '<name>' exists", () => {
    expect(sync).toContain(
      'numbered_copy_original("Plan 2.excalidraw").as_deref(), Some("Plan.excalidraw")',
    );
  });

  it("the native rule leaves the app's own 'Untitled N' alone", () => {
    expect(sync).toMatch(/Untitled/);
  });
});
