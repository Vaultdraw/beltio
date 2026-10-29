/**
 * Family: every network purpose x {online, offline, allow false}. Offline mode and an explicit
 * false stop the feature before any request, with plain words; online is the default and nothing
 * is asked. The Rust side has the same table (`network.rs`, every_purpose_online_offline_and_allow_false).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeFetchImage } from "../plugins/host/fakeBackend";
import { setOfflineMode } from "../network/offlineMode";
import {
  resetStartupUpdateCheck,
  runStartupUpdateCheck,
} from "../network/startupUpdateCheck";
import { blockReason, unblock } from "../theme/install/consent";
import { toastStore } from "../toasts/toastStore";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  isOffline,
  updatePreferences,
} from "../vault/preferences";

const RESET = {
  networkOffline: false,
  networkEnabled: true,
  networkAllowThemes: undefined,
  networkAllowPlugins: undefined,
  networkAllowImages: undefined,
  networkAllowUpdates: undefined,
  updatesCheckOnStartup: true,
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const net = () => ({
  images: { "https://example.com/a.png": PNG } as Record<string, Uint8Array>,
  allowed: true,
  offline: () => isOffline(getPreferences()),
  asked: [] as string[][],
  fetched: [] as string[],
});

beforeEach(() => {
  updatePreferences(RESET);
  resetStartupUpdateCheck();
  toastStore.clear();
});
afterEach(() => {
  updatePreferences(RESET);
  vi.restoreAllMocks();
});

type State = "online" | "offline" | "old switch off" | "allow false";

/** The fields a state sets for one purpose. */
const setup = (state: State, allowField: string | null) => {
  updatePreferences({
    networkOffline: state === "offline",
    networkEnabled: state !== "old switch off",
    ...(allowField && state === "allow false" ? { [allowField]: false } : {}),
  });
};

describe("downloads that name a switch (themes, plugins)", () => {
  const purposes = [
    ["themes", "networkAllowThemes"],
    ["plugins", "networkAllowPlugins"],
  ] as const;
  for (const [purpose, field] of purposes) {
    it(`${purpose}: online allowed, offline and allow false say why`, () => {
      setup("online", field);
      expect(blockReason(field)).toBeNull();
      for (const state of ["offline", "old switch off"] as const) {
        setup(state, field);
        expect(blockReason(field), state).toMatch(/^Offline mode is on\./);
      }
      setup("allow false", field);
      expect(blockReason(field)).toMatch(/turned off in Settings\.$/);
    });
  }

  it("no message has a config key or a code name", () => {
    for (const [, field] of purposes) {
      for (const state of ["offline", "allow false"] as const) {
        setup(state, field);
        expect(blockReason(field)).not.toMatch(/network\.|allow_|`|_/);
      }
    }
  });
});

describe("web pictures", () => {
  it("online loads, offline and allow false refuse before the table is touched", () => {
    const n = net();
    setup("online", null);
    expect(fakeFetchImage(n, "https://example.com/a.png")).toBe(PNG);
    expect(n.fetched).toHaveLength(1);
    for (const state of ["offline", "old switch off"] as const) {
      setup(state, null);
      expect(() => fakeFetchImage(n, "https://example.com/a.png")).toThrow(
        expect.objectContaining({ code: "NETWORK_DISABLED" }),
      );
    }
    setup("online", null);
    n.allowed = false;
    expect(() => fakeFetchImage(n, "https://example.com/a.png")).toThrow(
      expect.objectContaining({ code: "NETWORK_NOT_ALLOWED" }),
    );
    expect(n.fetched).toHaveLength(1);
  });
});

describe("the update check", () => {
  const found = {
    version: "9.9.9",
    url: "https://github.com/Vaultdraw/vaultdraw/releases/tag/v9.9.9",
  };
  const win = window;

  it("online: asks once per launch and tells only about a newer version", async () => {
    const invoke = vi.fn(async () => found);
    const notify = vi.fn();
    expect(await runStartupUpdateCheck(win, { invoke, notify })).toBe(true);
    expect(await runStartupUpdateCheck(win, { invoke, notify })).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("update_check");
    expect(notify).toHaveBeenCalledWith(found);
  });

  it("up to date or a failed request: no notice", async () => {
    const notify = vi.fn();
    await runStartupUpdateCheck(win, { invoke: async () => null, notify });
    resetStartupUpdateCheck();
    await runStartupUpdateCheck(win, {
      invoke: async () => {
        throw new Error("offline");
      },
      notify,
    });
    expect(notify).not.toHaveBeenCalled();
  });

  const off: [string, Record<string, unknown>][] = [
    ["Offline mode", { networkOffline: true }],
    ["the old master switch", { networkEnabled: false }],
    ["updates.check_on_startup = false", { updatesCheckOnStartup: false }],
    ["network.allow_updates = false", { networkAllowUpdates: false }],
  ];
  for (const [name, patch] of off) {
    it(`${name}: no request at all`, async () => {
      updatePreferences(patch);
      const invoke = vi.fn(async () => found);
      expect(
        await runStartupUpdateCheck(win, { invoke, notify: vi.fn() }),
      ).toBe(false);
      expect(invoke).not.toHaveBeenCalled();
    });
  }
});

describe("Offline mode makes no request at all", () => {
  it("fails on any fetch, picture download, update check or list while offline", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("a request left the app");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const invoke = vi.fn(async () => {
      throw new Error("a native network call was made");
    });
    updatePreferences({ networkOffline: true });
    const n = net();

    expect(() => fakeFetchImage(n, "https://example.com/a.png")).toThrow();
    expect(
      await runStartupUpdateCheck(window, { invoke, notify: vi.fn() }),
    ).toBe(false);
    expect(blockReason("networkAllowThemes")).not.toBeNull();
    expect(blockReason("networkAllowPlugins")).not.toBeNull();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(n.fetched).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("the Offline mode switch", () => {
  it("flips, clears the old master switch, and tells the user", () => {
    updatePreferences({ networkEnabled: false });
    expect(isOffline(getPreferences())).toBe(true);
    expect(setOfflineMode(false)).toBe(false);
    expect(getPreferences().networkEnabled).toBe(true);
    expect(isOffline(getPreferences())).toBe(false);
    expect(setOfflineMode()).toBe(true);
    expect(getPreferences().networkOffline).toBe(true);
    expect(
      toastStore
        .getSnapshot()
        .toasts.map((t) => t.message)
        .join("|"),
    ).toMatch(/Offline mode is on/);
  });

  it("unblock turns Offline mode off and a single download back on", async () => {
    updatePreferences({ networkOffline: true, networkAllowPlugins: false });
    expect(await unblock("networkAllowPlugins")).toBe(true);
    expect(getPreferences().networkOffline).toBe(false);
    expect(getPreferences().networkAllowPlugins).toBeUndefined();
  });

  it("defaults: online, updates on", () => {
    expect(DEFAULT_PREFERENCES.networkOffline).toBe(false);
    expect(DEFAULT_PREFERENCES.updatesCheckOnStartup).toBe(true);
  });
});
