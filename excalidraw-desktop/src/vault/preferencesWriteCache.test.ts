import { describe, expect, it, vi } from "vitest";

import {
  addRecentVault,
  getPreferences,
  getRecentVaults,
  updatePreferences,
} from "./preferences";

const makeWin = () => {
  const store: Record<string, string> = {};
  const getItem = vi.fn((k: string) => store[k] ?? null);
  const win = {
    localStorage: {
      getItem,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    },
  } as unknown as Window;
  return { win, store, getItem };
};

describe("preferences write path keeps the written snapshot in the cache", () => {
  it("addRecentVault: the next read returns the written snapshot without re-parsing", () => {
    const { win } = makeWin();
    const parse = vi.spyOn(JSON, "parse");
    addRecentVault("/vault/a", win);
    const before = parse.mock.calls.length;
    const snap = getPreferences(win);
    expect(parse.mock.calls.length).toBe(before);
    expect(snap.lastVaultPath).toBe("/vault/a");
    expect(getPreferences(win)).toBe(snap);
    parse.mockRestore();
  });

  it("the cached snapshot equals what a fresh parse of storage gives", () => {
    const { win, store } = makeWin();
    addRecentVault("/vault/a", win);
    addRecentVault("/vault/b", win);
    const cached = getPreferences(win);
    // a second window holding the same stored text parses it from scratch
    const win2 = makeWin();
    for (const k of Object.keys(store)) {
      win2.store[k] = store[k]!;
    }
    expect(getRecentVaults(win)).toEqual(["/vault/b", "/vault/a"]);
    expect(getPreferences(win2.win)).toEqual(cached);
  });

  it("untrusted updatePreferences still normalises on the next read", () => {
    const { win } = makeWin();
    updatePreferences({ recentVaults: ["/x"] }, win);
    expect(getPreferences(win).recentVaults).toEqual(["/x"]);
  });
});
