import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, render } from "@testing-library/react";

import { getCommand } from "../commands/commands";
import { getRegisteredHandler } from "../commands/handlerRegistry";
import { toastStore } from "../toasts/toastStore";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  normalizePreferences,
  updatePreferences,
} from "../vault/preferences";
import {
  configToPreferences,
  preferencesToConfigChanges,
} from "../vault/settingsSync";

import { watchdogControls } from "../components/settings/pages/Watchdog";

import { WatchdogHost } from "./WatchdogHost";

const invokeMock = vi.fn();
vi.mock("../vault/DesktopVaultRepository", () => ({
  loadTauriInvoke: async () => invokeMock,
  isTauriAvailable: () => false,
}));

const lastToast = () => toastStore.getSnapshot().toasts.at(-1)?.message;

describe("[watchdog] keys", () => {
  it("default to on and 5000 ms", () => {
    expect(DEFAULT_PREFERENCES.watchdogEnabled).toBe(true);
    expect(DEFAULT_PREFERENCES.watchdogGraceMs).toBe(5000);
    const { values, problems } = configToPreferences({});
    expect(values.watchdogEnabled).toBe(true);
    expect(values.watchdogGraceMs).toBe(5000);
    expect(problems.filter((p) => p.key?.startsWith("watchdog."))).toEqual([]);
  });

  it("read valid values", () => {
    const { values, problems } = configToPreferences({
      watchdog: { enabled: false, grace_ms: 1000 },
    });
    expect(problems).toEqual([]);
    expect(values.watchdogEnabled).toBe(false);
    expect(values.watchdogGraceMs).toBe(1000);
    expect(
      configToPreferences({ watchdog: { grace_ms: 60000 } }).problems,
    ).toEqual([]);
  });

  it("count a bad value as the default and report it", () => {
    for (const bad of [999, 60001, 2500.5, "5000", true]) {
      const { values, problems } = configToPreferences({
        watchdog: { grace_ms: bad },
      });
      expect(values.watchdogGraceMs).toBe(5000);
      expect(problems.map((p) => p.key)).toEqual(["watchdog.grace_ms"]);
    }
    const { values, problems } = configToPreferences({
      watchdog: { enabled: "yes" },
    });
    expect(values.watchdogEnabled).toBe(true);
    expect(problems.map((p) => p.key)).toEqual(["watchdog.enabled"]);
  });

  it("normalise stored preferences the same way", () => {
    const prefs = normalizePreferences({
      watchdogEnabled: "no",
      watchdogGraceMs: 10,
    });
    expect(prefs.watchdogEnabled).toBe(true);
    expect(prefs.watchdogGraceMs).toBe(5000);
  });

  it("write back under [watchdog]", () => {
    const changes = preferencesToConfigChanges(DEFAULT_PREFERENCES, {
      ...DEFAULT_PREFERENCES,
      watchdogEnabled: false,
      watchdogGraceMs: 8000,
    });
    const byKey = Object.fromEntries(changes.map((c) => [c.key, c.value]));
    expect(byKey["watchdog.enabled"]).toBe(false);
    expect(byKey["watchdog.grace_ms"]).toBe(8000);
  });
});

describe("watchdog commands", () => {
  beforeEach(() => {
    window.localStorage.clear();
    invokeMock.mockReset();
    toastStore.clear();
    updatePreferences({ watchdogEnabled: true }, window);
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("are registered, unbound and need an open vault", () => {
    for (const [id, title] of [
      ["watchdog.toggle", "Hang watchdog: Turn on or off"],
      ["watchdog.showLastHang", "Hang watchdog: Show the last hang"],
    ]) {
      const command = getCommand(id)!;
      expect(command.title).toBe(title);
      expect(command.keys.default).toEqual([]);
      expect(command.when).toEqual(["vaultOpen", "!modalOpen"]);
    }
  });

  // jsdom's user agent names the host system, so both fields are set.
  const asPlatform = (platform: string) => {
    for (const key of ["platform", "userAgent"]) {
      Object.defineProperty(window.navigator, key, {
        value: platform,
        configurable: true,
      });
    }
  };
  afterEach(() => {
    const nav = window.navigator as unknown as Record<string, unknown>;
    delete nav.platform;
    delete nav.userAgent;
  });

  it("are bound on macOS only, where the watchdog runs (toimprove 307)", () => {
    asPlatform("Linux x86_64");
    const linux = render(<WatchdogHost win={window} />);
    expect(getRegisteredHandler("watchdog.toggle")).toBeUndefined();
    linux.unmount();
    asPlatform("MacIntel");
    render(<WatchdogHost win={window} />);
    expect(getRegisteredHandler("watchdog.toggle")).toBeTypeOf("function");
  });

  it("its Settings rows are offered on macOS only", () => {
    const ctx = { win: window } as unknown as Parameters<
      NonNullable<typeof watchdogControls["watchdog-enabled"]["available"]>
    >[0];
    for (const id of ["watchdog-enabled", "watchdog-grace"]) {
      asPlatform("Linux x86_64");
      expect(watchdogControls[id].available!(ctx), id).toBe(false);
      asPlatform("MacIntel");
      expect(watchdogControls[id].available!(ctx), id).toBe(true);
    }
  });

  it("toggle flips the preference and says so", () => {
    asPlatform("MacIntel");
    render(<WatchdogHost win={window} />);
    const run = getRegisteredHandler("watchdog.toggle")!;
    run();
    expect(getPreferences(window).watchdogEnabled).toBe(false);
    expect(lastToast()).toBe("Hang watchdog off");
    run();
    expect(getPreferences(window).watchdogEnabled).toBe(true);
    expect(lastToast()).toBe("Hang watchdog on");
  });

  it("show the last hang reads the native record", async () => {
    asPlatform("MacIntel");
    invokeMock.mockResolvedValue({
      atMs: Date.UTC(2026, 9, 27, 12, 0, 0),
      secondsUnresponsive: 12,
      choice: "quit",
    });
    render(<WatchdogHost win={window} />);
    getRegisteredHandler("watchdog.showLastHang")!();
    await vi.waitFor(() => expect(lastToast()).toContain("Last hang: "));
    expect(invokeMock).toHaveBeenCalledWith("watchdog_last_hang");
    expect(lastToast()).toContain("12 s, you chose Quit");
  });

  it("says no hang when there is none or the call fails", async () => {
    asPlatform("MacIntel");
    render(<WatchdogHost win={window} />);
    const run = getRegisteredHandler("watchdog.showLastHang")!;
    invokeMock.mockResolvedValue(null);
    run();
    await vi.waitFor(() => expect(lastToast()).toBe("No hang recorded"));
    toastStore.clear();
    invokeMock.mockRejectedValue(new Error("no tauri"));
    run();
    await vi.waitFor(() => expect(lastToast()).toBe("No hang recorded"));
  });
});
