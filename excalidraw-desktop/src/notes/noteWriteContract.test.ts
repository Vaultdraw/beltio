import { describe, expect, it } from "vitest";

import contract from "../../src-tauri/crates/vaultdraw-core/src/contract/note_write.json";

import { FakeNoteFiles, fakeRevision } from "./FakeNoteFiles";

/**
 * FakeNoteFiles (the browser e2e backend) must answer like the native write_note_file:
 * the same table drives src-tauri/crates/vaultdraw-core/src/note_file.rs `contract`.
 * Round 7 of the bug hunt could not reproduce BH-9 in Playwright because the fake
 * accepted writes the backend refused.
 */
type Case = {
  name: string;
  disk: Record<string, string>;
  path: string;
  base: "none" | "current" | "stale";
  expect: string;
};

describe("FakeNoteFiles follows the native note write contract", () => {
  it.each((contract.cases as Case[]).map((c) => [c.name, c] as const))(
    "%s",
    async (_name, c) => {
      const files = new FakeNoteFiles();
      for (const [p, text] of Object.entries(c.disk)) {
        if (p.endsWith("/")) {
          files.setFolder(p.slice(0, -1));
        } else {
          files.setOnDisk(p, text);
        }
      }
      const current = c.disk[c.path];
      const base =
        c.base === "none"
          ? null
          : c.base === "current" && current !== undefined
          ? fakeRevision(current)
          : "0".repeat(64);
      const got = await files.write("h", c.path, "new text", base).then(
        () => "ok",
        (e: { code?: string }) => e.code ?? String(e),
      );
      expect(got).toBe(c.expect);
    },
  );
});
