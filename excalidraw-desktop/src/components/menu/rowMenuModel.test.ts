import { describe, expect, it, vi } from "vitest";

import { buildRowMenu, type RowMenuActions } from "./rowMenuModel";
import { pathText } from "./copyPath";

import type { MenuNode } from "./menuModel";
import type { VaultEntry } from "../../vault/types";

const entry = (
  kind: VaultEntry["kind"],
  path = "A/b",
  extra = {},
): VaultEntry =>
  ({ path, name: path, kind, modifiedAt: 0, size: 0, ...extra } as VaultEntry);

const actions = (): RowMenuActions => ({
  newInside: vi.fn(),
  duplicate: vi.fn(),
  saveAsTemplate: vi.fn(),
  rename: vi.fn(),
  move: vi.fn(),
  reveal: vi.fn(),
  exportAs: vi.fn(),
  trash: vi.fn(),
  localGraph: vi.fn(),
  history: vi.fn(),
  copyPath: vi.fn(),
});

/** Labels with "|" for a divider and "label>" for a submenu. */
const shape = (nodes: MenuNode[]): string[] =>
  nodes.map((n) =>
    n.kind === "separator"
      ? "|"
      : n.kind === "submenu"
      ? `${n.label}>`
      : n.label,
  );

const menu = (e: VaultEntry, readOnly = false, a = actions()) =>
  buildRowMenu({ entry: e, readOnly, actions: a, pluginItems: [] });

describe("row menu groups", () => {
  it("folder: create, organise, copy path, reveal, rename, trash last", () => {
    expect(shape(menu(entry("folder")))).toEqual([
      "New drawing",
      "New folder",
      "|",
      "Move to…",
      "|",
      "Copy path>",
      "|",
      "Reveal in file manager",
      "|",
      "Rename…",
      "Move to Trash",
    ]);
  });

  it("drawing: duplicate, template, move, graph, history, export submenu", () => {
    expect(shape(menu(entry("drawing")))).toEqual([
      "Duplicate",
      "Save as template…",
      "Move to…",
      "Open local graph",
      "History",
      "Export>",
      "|",
      "Copy path>",
      "|",
      "Reveal in file manager",
      "|",
      "Rename…",
      "Move to Trash",
    ]);
  });

  it("read-only vault: no create, no edits, no trash; copy and reveal stay", () => {
    expect(shape(menu(entry("folder"), true))).toEqual([
      "Copy path>",
      "|",
      "Reveal in file manager",
    ]);
  });

  it.each(["note", "excalidrawMd"] as const)(
    "%s: move, copy path, reveal, rename and trash (like Obsidian and Finder)",
    (kind) => {
      expect(shape(menu(entry(kind)))).toEqual([
        "Move to…",
        "|",
        "Copy path>",
        "|",
        "Reveal in file manager",
        "|",
        "Rename…",
        "Move to Trash",
      ]);
    },
  );

  it.each(["note", "excalidrawMd", "drawing", "folder"] as const)(
    "read-only vault: a %s offers no rename, move or trash",
    (kind) => {
      const labels = shape(menu(entry(kind), true));
      for (const label of ["Rename…", "Move to…", "Move to Trash"]) {
        expect(labels).not.toContain(label);
      }
    },
  );

  it("trash is last and dangerous; a folder has no link", () => {
    const nodes = menu(entry("folder"));
    const last = nodes[nodes.length - 1];
    expect(last).toMatchObject({ label: "Move to Trash", danger: true });
    const copy = nodes.find((n) => n.kind === "submenu" && n.id === "copyPath");
    expect(
      copy &&
        copy.kind === "submenu" &&
        copy.items.map((i) => i.kind === "item" && i.label),
    ).toEqual(["Relative to vault", "Absolute path"]);
  });

  it("items run the matching action with the row", () => {
    const a = actions();
    const e = entry("drawing");
    const nodes = menu(e, false, a);
    const run = (label: string) => {
      const n = nodes.find((x) => x.kind === "item" && x.label === label);
      n && n.kind === "item" && n.run();
    };
    run("Move to Trash");
    run("Rename…");
    expect(a.trash).toHaveBeenCalledWith(e);
    expect(a.rename).toHaveBeenCalledWith(e);
  });

  it("plugin items sit before rename and trash", () => {
    const run = vi.fn();
    const nodes = buildRowMenu({
      entry: entry("folder"),
      readOnly: false,
      actions: actions(),
      pluginItems: [
        { command: "gallery.show-folder", title: "Show as grid", run },
      ],
    });
    const labels = shape(nodes);
    expect(labels.indexOf("Show as grid")).toBeGreaterThan(
      labels.indexOf("Reveal in file manager"),
    );
    expect(labels.indexOf("Show as grid")).toBeLessThan(
      labels.indexOf("Rename…"),
    );
  });

  it("sync flags add their item", () => {
    const labels = shape(
      buildRowMenu({
        entry: entry("drawing", "x", { sync: "conflict" }),
        readOnly: false,
        actions: { ...actions(), syncAction: vi.fn() },
        pluginItems: [],
      }),
    );
    expect(labels).toContain("Compare with original…");
  });
});

describe("pathText", () => {
  it("formats the three kinds", () => {
    expect(pathText("relative", "A/b.excalidraw", "/v")).toBe("A/b.excalidraw");
    expect(pathText("absolute", "A/b.excalidraw", "/v/")).toBe(
      "/v/A/b.excalidraw",
    );
    expect(pathText("link", "A/My file", "/v")).toBe(
      "vaultdraw://open?file=A/My%20file",
    );
  });
});
