import { afterEach, describe, expect, it, vi } from "vitest";

import {
  commandsVersion,
  getRegisteredCommand,
  isLegacyCommandId,
  registerCommands,
  registeredCommands,
  subscribeCommands,
} from "./registry";

import type { CommandDefinition } from "./types";

const def = (id: string, extra: Partial<CommandDefinition> = {}) =>
  ({
    id,
    title: id,
    category: "Test",
    keys: { default: [] },
    ...extra,
  } as CommandDefinition);

const disposers: (() => void)[] = [];
const reg = (...defs: CommandDefinition[]) => {
  const d = registerCommands(defs);
  disposers.push(d);
  return d;
};

afterEach(() => {
  disposers.splice(0).forEach((d) => d());
  vi.restoreAllMocks();
});

describe("command registry", () => {
  it("registers in order and disposes only its own", () => {
    const before = registeredCommands().length;
    const a = reg(def("t.a"), def("t.b"));
    reg(def("t.c"));
    expect(
      registeredCommands()
        .slice(before)
        .map((c) => c.id),
    ).toEqual(["t.a", "t.b", "t.c"]);
    a();
    expect(getRegisteredCommand("t.a")).toBeUndefined();
    expect(getRegisteredCommand("t.c")).toBeDefined();
  });

  it("refuses duplicates (first wins) and still registers the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = def("t.dup", { title: "first" });
    reg(first);
    const dispose = reg(def("t.dup", { title: "second" }), def("t.other"));
    expect(getRegisteredCommand("t.dup")).toBe(first);
    expect(getRegisteredCommand("t.other")).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(1);
    dispose(); // must not remove the first registration of t.dup
    expect(getRegisteredCommand("t.dup")).toBe(first);
    expect(getRegisteredCommand("t.other")).toBeUndefined();
  });

  it("tracks legacy ids and refuses a clash with them", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const dispose = reg(def("t.new", { legacy: { id: "t.old" } }));
    expect(isLegacyCommandId("t.old")).toBe(true);
    reg(def("t.old"));
    expect(getRegisteredCommand("t.old")).toBeUndefined();
    dispose();
    expect(isLegacyCommandId("t.old")).toBe(false);
  });

  it("refuses malformed definitions", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reg(
      ...([
        { id: "", title: "x", category: "T", keys: { default: [] } },
        { id: "t.x", title: 1, category: "T", keys: { default: [] } },
        { id: "t.y", title: "y", category: "T", keys: {} },
      ] as unknown as CommandDefinition[]),
    );
    expect(warn).toHaveBeenCalledTimes(3);
    expect(getRegisteredCommand("t.x")).toBeUndefined();
  });

  it("keeps the snapshot identity until a change", () => {
    const s1 = registeredCommands();
    expect(registeredCommands()).toBe(s1);
    const dispose = reg(def("t.snap"));
    const s2 = registeredCommands();
    expect(s2).not.toBe(s1);
    expect(registeredCommands()).toBe(s2);
    dispose();
    expect(registeredCommands()).not.toBe(s2);
  });

  it("notifies once per call and bumps the version", () => {
    const listener = vi.fn();
    const off = subscribeCommands(listener);
    const v = commandsVersion();
    const dispose = reg(def("t.n1"), def("t.n2"));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(commandsVersion()).toBe(v + 1);
    dispose();
    expect(listener).toHaveBeenCalledTimes(2);
    reg(); // nothing added: no notification
    off();
    reg(def("t.n3"));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
