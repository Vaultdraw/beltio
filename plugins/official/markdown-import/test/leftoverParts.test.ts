/**
 * Family (hunter A-4, 2026-10-30): a re-imported note whose part count changed. Parts that grow,
 * shrink or stay the same; leftover parts untouched, edited or from an older import; look-alike
 * names that are not parts of this note.
 */
import { describe, expect, test } from "vitest";

import { dropLeftoverParts, type ReimportSummary } from "../src/reimport";

import type { PluginContext } from "@vaultdraw/api";

type State = "untouched" | "changed" | "unknown";

const run = async (
  files: Record<string, State>,
  head: string,
  partCount: number,
) => {
  const trashed: string[] = [];
  const ctx = {
    host: { has: () => true },
    vault: {
      async list(dir: string) {
        return Object.keys(files)
          .filter((p) => p.slice(0, Math.max(0, p.lastIndexOf("/"))) === dir)
          .map((path) => ({ path, kind: "drawing" }));
      },
      async trashDrawing(path: string, o: { onlyIfUntouched?: boolean }) {
        expect(o.onlyIfUntouched).toBe(true);
        if (files[path] !== "untouched") {
          return { skipped: files[path] };
        }
        trashed.push(path);
        return { trashed: true };
      },
    },
  } as unknown as PluginContext;
  const summary: ReimportSummary = {
    written: [head],
    changed: [],
    unknown: [],
    partsTrashed: [],
    partsKept: [],
    notFound: [],
    failed: [],
  };
  await dropLeftoverParts(ctx, head, partCount, summary);
  return { trashed, kept: summary.partsKept };
};

const V = "Vault/Long.excalidraw";
const part = (n: number) => `Vault/Long (part ${n}).excalidraw`;

describe("re-import: leftover parts of a note whose length changed", () => {
  test.each<[string, Record<string, State>, number, string[], string[]]>([
    ["same length", { [V]: "untouched", [part(2)]: "untouched" }, 2, [], []],
    ["grew", { [V]: "untouched", [part(2)]: "untouched" }, 3, [], []],
    [
      "shrank to one page",
      { [V]: "untouched", [part(2)]: "untouched", [part(3)]: "untouched" },
      1,
      [part(2), part(3)],
      [],
    ],
    [
      "shrank, one leftover part edited",
      { [V]: "untouched", [part(2)]: "untouched", [part(3)]: "changed" },
      1,
      [part(2)],
      [part(3)],
    ],
    [
      "shrank, leftover from an older import",
      { [V]: "untouched", [part(2)]: "unknown" },
      1,
      [],
      [part(2)],
    ],
    [
      "shrank by one",
      { [V]: "untouched", [part(2)]: "untouched", [part(3)]: "untouched" },
      2,
      [part(3)],
      [],
    ],
    [
      "look-alike names are not parts",
      {
        [V]: "untouched",
        "Vault/Long (part 2) copy.excalidraw": "untouched",
        "Vault/Longer (part 2).excalidraw": "untouched",
        "Vault/Sub/Long (part 2).excalidraw": "untouched",
        "Vault/Long (part two).excalidraw": "untouched",
      },
      1,
      [],
      [],
    ],
  ])("%s", async (_name, files, count, trashed, kept) => {
    const r = await run(files, V, count);
    expect(r.trashed.sort()).toEqual(trashed);
    expect(r.kept.sort()).toEqual(kept);
  });

  test("a note name with regex characters", async () => {
    const head = "Vault/C++ (notes).excalidraw";
    const r = await run(
      {
        [head]: "untouched",
        "Vault/C++ (notes) (part 2).excalidraw": "untouched",
      },
      head,
      1,
    );
    expect(r.trashed).toEqual(["Vault/C++ (notes) (part 2).excalidraw"]);
  });
});
