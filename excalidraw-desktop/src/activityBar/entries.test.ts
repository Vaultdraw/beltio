import { describe, expect, it } from "vitest";

import { getCommand } from "../commands/commands";
import { OFFICIAL_PLUGINS } from "../plugins/officialPlugins";

import { placeAfter } from "./activityBarRegistry";

import {
  ACTIVITY_ENTRIES,
  resolveEntryState,
  type EntryContext,
} from "./entries";

const ctx = (over: Partial<EntryContext> = {}): EntryContext => ({
  drawingOpen: true,
  hasHandler: () => true,
  isAvailable: () => true,
  shortcut: () => "",
  ...over,
});

const entry = ACTIVITY_ENTRIES.find((e) => e.id === "library")!;

describe("ACTIVITY_ENTRIES", () => {
  it("has unique ids", () => {
    const ids = ACTIVITY_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("runs only registered commands", () => {
    for (const e of ACTIVITY_ENTRIES) {
      expect(getCommand(e.commandId), e.commandId).toBeDefined();
    }
  });

  it("takes the graph's entry from the plugin, right behind history", () => {
    expect(ACTIVITY_ENTRIES.some((e) => e.id === "graph")).toBe(false);
    const a = OFFICIAL_PLUGINS.find((p) => p.id === "graph")!.activity!;
    expect(a).toMatchObject({ id: "graph", icon: "graph", after: "history" });
    const gallery = OFFICIAL_PLUGINS.find((p) => p.id === "gallery")!.activity!;
    const mk = (x: { id: string; after?: string }) =>
      ({ ...ACTIVITY_ENTRIES[0], ...x } as typeof ACTIVITY_ENTRIES[number]);
    // gallery is registered before graph and sits behind it: both still land in place
    const out = placeAfter([...ACTIVITY_ENTRIES, mk(gallery), mk(a)]).map(
      (e) => e.id,
    );
    expect(out.slice(0, 4)).toEqual(["library", "history", "graph", "gallery"]);
  });

  it("lists the expected entries by group", () => {
    const of = (g: string) =>
      ACTIVITY_ENTRIES.filter((e) => e.group === g).map((e) => e.id);
    expect(of("top")).toEqual([
      "library",
      "history",
      "search",
      "tags",
      "templates",
    ]);
    expect(of("bottom")).toEqual(["hotkeys", "settings"]);
  });

  it("gives toggling panel entries an active store", () => {
    for (const id of ["library", "history"]) {
      expect(ACTIVITY_ENTRIES.find((e) => e.id === id)?.active).toBeDefined();
    }
  });
});

describe("resolveEntryState", () => {
  it("hides an entry whose command has no handler", () => {
    expect(
      resolveEntryState(entry, ctx({ hasHandler: () => false })).hidden,
    ).toBe(true);
  });

  it("disables a drawing entry with a reason when no drawing is open, even with no handler", () => {
    expect(
      resolveEntryState(
        entry,
        ctx({ drawingOpen: false, hasHandler: () => false }),
      ),
    ).toEqual({
      hidden: false,
      disabled: true,
      title: "Library - Open a drawing first",
    });
  });

  it("hides a vault entry with no handler even when no drawing is open", () => {
    const tags = ACTIVITY_ENTRIES.find((e) => e.id === "tags")!;
    expect(
      resolveEntryState(
        tags,
        ctx({ drawingOpen: false, hasHandler: () => false }),
      ).hidden,
    ).toBe(true);
  });

  it("disables when the command is otherwise unavailable", () => {
    expect(resolveEntryState(entry, ctx({ isAvailable: () => false }))).toEqual(
      {
        hidden: false,
        disabled: true,
        title: "Library - Not available now",
      },
    );
  });

  it("enables with the shortcut in the tooltip", () => {
    expect(resolveEntryState(entry, ctx({ shortcut: () => "Ctrl+L" }))).toEqual(
      {
        hidden: false,
        disabled: false,
        title: "Library (Ctrl+L)",
      },
    );
  });

  it("omits the parentheses when unbound", () => {
    expect(resolveEntryState(entry, ctx()).title).toBe("Library");
  });
});
