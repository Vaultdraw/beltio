import { describe, expect, it } from "vitest";

import { rowHeadings, withCreateRow } from "./group";
import { prepareDrawings, prepareItems, rankRows } from "./rank";

import type { PaletteItem } from "./types";

const drawings = prepareDrawings(["Notes/alpha.excalidraw", "beta.excalidraw"]);
const none = prepareItems([]);
const rank = (q: string) => rankRows(drawings, none, q, []);

describe("withCreateRow", () => {
  it("appends a Create row for a fresh name", () => {
    const rows = withCreateRow(rank("alp"), "alp", "files", true);
    expect(rows.map((r) => r.kind)).toEqual(["drawing", "create"]);
    expect(rows[1]).toMatchObject({ kind: "create", name: "alp" });
  });

  it("skips it for an exact name (any case, folder or extension ignored)", () => {
    expect(withCreateRow(rank("ALPHA"), "ALPHA", "files", true)).toHaveLength(
      1,
    );
    expect(
      withCreateRow(rank("beta.excalidraw"), "beta.excalidraw", "files", true),
    ).toHaveLength(1);
  });

  it("skips it when disabled, empty, commands mode or the name is a path", () => {
    const rows = rank("zzz");
    expect(withCreateRow(rows, "zzz", "files", false)).toBe(rows);
    expect(withCreateRow(rows, "  ", "files", true)).toBe(rows);
    expect(withCreateRow(rows, "zzz", "commands", true)).toBe(rows);
    expect(withCreateRow(rows, "a/b", "files", true)).toBe(rows);
  });
});

describe("rowHeadings", () => {
  it("groups files results: Best match, Other matches, Create", () => {
    const rows = withCreateRow(rank("a"), "a", "files", true);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const heads = rowHeadings(rows, "files", true);
    expect(heads[0]).toBe("Best match");
    expect(heads[1]).toBe("Other matches");
    expect(heads.at(-1)).toBe("Create");
    expect(heads.filter(Boolean)).toHaveLength(3);
  });

  it("has no headings for an empty query or commands mode", () => {
    expect(rowHeadings(rank(""), "files", false).every((h) => !h)).toBe(true);
    const items: PaletteItem[] = [
      { key: "a", title: "Alpha", group: "g", run: () => {} },
    ];
    const rows = rankRows(drawings, prepareItems(items), ">a", []);
    expect(rowHeadings(rows, "commands", true).every((h) => !h)).toBe(true);
  });

  it("is a single pass: one heading slot per row", () => {
    const rows = rank("a");
    expect(rowHeadings(rows, "files", true)).toHaveLength(rows.length);
  });

  it("commands without a query: each group once as a header, recents first", () => {
    const items: PaletteItem[] = [
      { key: "e1", title: "Export: PDF", group: "Export", run: () => {} },
      { key: "e2", title: "Export: PNG", group: "Export", run: () => {} },
      { key: "v1", title: "View: Zen", group: "View", run: () => {} },
      { key: "v2", title: "View: Grid", group: "View", run: () => {} },
    ];
    const rows = rankRows(drawings, prepareItems(items), ">", ["v2"]);
    const heads = rowHeadings(rows, "commands", false, ["v2"]);
    expect(rows.map((r) => r.key)).toEqual(["v2", "e1", "e2", "v1"]);
    expect(heads).toEqual(["Recently used", "Export", null, "View"]);
  });
});
