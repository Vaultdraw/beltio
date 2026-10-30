import { describe, expect, it } from "vitest";

import { fileKind } from "../vault/fileKind";
import { duplicateName } from "../vault/treeStore";

/**
 * Hunter F-9 (2026-10-30). `fileKind` treats `.excalidraw` in any case as a drawing (the tree
 * lists `Plan.EXCALIDRAW` and opens it), but several callers test the suffix case-sensitively:
 * `duplicateName` (`vault/treeStore.ts:47`), the inline create dialog
 * (`VaultNavigator.tsx:697`) and the plugin vault API (`plugins/host/vaultContext.ts:94, 141`).
 */
describe("hunter F-9: a drawing with an upper-case extension is handled like any other", () => {
  it("(context) fileKind lists it as a drawing", () => {
    expect(fileKind("Plan.EXCALIDRAW")).toBe("drawing");
  });
  it.fails("Duplicate of Plan.EXCALIDRAW is 'Plan copy.excalidraw'", () => {
    expect(duplicateName("Plan.EXCALIDRAW")).toBe("Plan copy.excalidraw");
  });
});
