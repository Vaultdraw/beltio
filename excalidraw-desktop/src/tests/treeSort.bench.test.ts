import { describe, expect, it } from "vitest";

import { SORT_ORDERS, type SortOrder } from "../vault/sortOrder";
import { buildTree } from "../vault/treeStore";

import type { VaultEntry } from "../vault/types";

// Timing check, outside the fast tier (wall-clock).
const entry = (
  path: string,
  kind: VaultEntry["kind"],
  modifiedAt = 0,
): VaultEntry => ({
  path,
  name: path.split("/").pop()!,
  kind,
  modifiedAt,
  size: 0,
});

describe("buildTree speed (5,000 entries)", () => {
  const big = new Map<string, VaultEntry[]>();
  const folders: VaultEntry[] = [];
  for (let f = 0; f < 50; f++) {
    const dir = `Folder ${f}`;
    folders.push(entry(dir, "folder", f));
    const drawings: VaultEntry[] = [];
    for (let d = 0; d < 99; d++) {
      drawings.push(entry(`${dir}/Drawing ${d}.excalidraw`, "drawing", d % 7));
    }
    big.set(dir, drawings);
  }
  big.set("", folders);

  it.each(SORT_ORDERS as readonly SortOrder[])("%s under 250 ms", (order) => {
    const start = performance.now();
    buildTree(big, "", order);
    expect(performance.now() - start).toBeLessThan(250);
  });
});
