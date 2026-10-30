import { describe, expect, it, vi } from "vitest";

import { BUILTIN_COMMANDS } from "../commands/commands";
import { buildRowMenu } from "../components/menu/rowMenuModel";

import type { RowMenuActions } from "../components/menu/rowMenuModel";
import type { VaultEntry } from "../vault/types";

/**
 * Hunter F-8 (2026-10-30), parity. Obsidian's first file action is "New note" (folder menu, ribbon,
 * palette) and "Make a copy" on a note. Here the vault lists, opens and edits notes, but nothing
 * in the app creates one except a link to a note that does not exist yet: no palette command, no
 * "New note" in the folder menu (`rowMenuModel.ts` `create` has New drawing and New folder), and
 * the row menu comment says "only drawings also get duplicate" while claiming to follow Obsidian.
 */
const entry = (kind: VaultEntry["kind"], path: string): VaultEntry =>
  ({ path, name: path, kind, modifiedAt: 0, size: 0 } as VaultEntry);

const actions = () =>
  new Proxy({}, { get: () => vi.fn() }) as unknown as RowMenuActions;

const labels = (e: VaultEntry) =>
  buildRowMenu({
    entry: e,
    readOnly: false,
    actions: actions(),
    pluginItems: [],
  })
    .map((n) => ("label" in n ? n.label : ""))
    .filter(Boolean);

describe("hunter F-8: notes can be made and copied from the app", () => {
  it.fails("the palette has a command that creates a note", () => {
    expect(
      BUILTIN_COMMANDS.some((c) => /new note|create note/i.test(c.title)),
    ).toBe(true);
  });
  it.fails("the folder menu offers New note", () => {
    expect(labels(entry("folder", "Ideas"))).toContain("New note");
  });
  it.fails("a note's menu offers Duplicate (Obsidian: Make a copy)", () => {
    expect(labels(entry("note", "Ideas/Plan.md"))).toContain("Duplicate");
  });
});
