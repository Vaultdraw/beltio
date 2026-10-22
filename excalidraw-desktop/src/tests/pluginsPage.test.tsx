/** Settings > Plugins: row states, safe-mode banner, enable consent. */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsModal } from "../components/settings/SettingsModal";
import { makePluginInfo } from "../plugins/host/fakeBackend";
import { getPreferences, updatePreferences } from "../vault/preferences";

import type { PluginsState } from "../plugins/host/manage";
import type { VaultInfo } from "../vault/types";

const h = vi.hoisted(() => {
  let state: any = null;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next: any) => {
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    clearHostDisabled: vi.fn(async () => {}),
    uninstallPlugin: vi.fn(async () => {}),
    runCommandById: vi.fn(async () => {}),
  };
});

vi.mock("../plugins/host/manage", () => ({
  getPluginsState: () => h.get(),
  subscribePluginsState: h.subscribe,
  clearHostDisabled: h.clearHostDisabled,
  uninstallPlugin: h.uninstallPlugin,
  reloadPlugin: vi.fn(async () => {}),
  rescanPlugins: vi.fn(async () => {}),
  restartInSafeMode: vi.fn(async () => {}),
  revealPluginFolder: vi.fn(async () => {}),
  pickPluginFolder: vi.fn(async () => null),
  installPluginFolder: vi.fn(),
}));
vi.mock("../plugins/host/runner", () => ({ runCommandById: h.runCommandById }));

const vault: VaultInfo = {
  handle: "p",
  name: "V",
  path: "/v",
  readOnly: false,
};

const state = (patch: Partial<PluginsState> = {}): PluginsState => ({
  plugins: [],
  errors: [],
  scanMs: 0,
  safeMode: null,
  runtime: {},
  ...patch,
});

/** The page is lazy: resolve once it has rendered. */
const open = async () => {
  render(
    <SettingsModal
      vault={vault}
      onClose={() => {}}
      ownerDocument={document}
      initialPage="plugins"
    />,
  );
  await screen.findByTestId("plugins-page");
};

describe("Plugins settings page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    updatePreferences({ pluginsEnabled: [] }, window);
    h.set(state());
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the empty state and broken manifests", async () => {
    h.set(state({ errors: [{ dir: "/p/bad", message: "no manifest" }] }));
    await open();
    expect(screen.getByText(/No plugins installed/)).toBeTruthy();
    expect(screen.getByText(/no manifest/)).toBeTruthy();
  });

  it("marks user plugins Unverified and asks before enabling", async () => {
    h.set(state({ plugins: [makePluginInfo("hello", { name: "Hello" })] }));
    await open();
    const row = screen.getByTestId("plugin-hello");
    expect(within(row).getByText("Unverified")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Enable Hello" }));
    expect(getPreferences(window).pluginsEnabled).toEqual([]);
    expect(screen.getByText(/not reviewed by Vaultdraw/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(getPreferences(window).pluginsEnabled).toEqual(["hello"]);
  });

  it("enables a bundled plugin without a dialog", async () => {
    h.set(
      state({
        plugins: [makePluginInfo("core", { name: "Core", source: "bundled" })],
      }),
    );
    await open();
    fireEvent.click(screen.getByRole("switch", { name: "Enable Core" }));
    expect(getPreferences(window).pluginsEnabled).toEqual(["core"]);
    expect(screen.queryByText("Unverified")).toBeNull();
  });

  it("disables the switch for an incompatible plugin and says why", async () => {
    h.set(
      state({
        plugins: [
          makePluginInfo("new", {
            name: "New",
            compatible: false,
            problem: "Needs app ≥ 9.0.0",
          }),
        ],
      }),
    );
    await open();
    expect(
      (screen.getByRole("switch", { name: "Enable New" }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("Needs app ≥ 9.0.0")).toBeTruthy();
  });

  it("offers Re-enable for a plugin the host disabled", async () => {
    h.set(
      state({
        plugins: [
          makePluginInfo("bad", { name: "Bad", hostDisabled: "3 errors" }),
        ],
      }),
    );
    await open();
    expect(screen.getByText(/Disabled by Vaultdraw: 3 errors/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Re-enable Bad" }));
    expect(h.clearHostDisabled).toHaveBeenCalledWith("bad");
  });

  it("shows runtime state, cost, and uninstall only for user plugins", async () => {
    updatePreferences({ pluginsEnabled: ["hello"] }, window);
    h.set(
      state({
        plugins: [
          makePluginInfo("hello", { name: "Hello" }),
          makePluginInfo("core", { name: "Core", source: "bundled" }),
        ],
        runtime: { hello: { state: "active", enabled: true } },
      }),
    );
    await open();
    const row = screen.getByTestId("plugin-hello");
    expect(within(row).getByText("Active")).toBeTruthy();
    expect(
      within(row).getByRole("button", { name: "Reload Hello" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Uninstall Core" })).toBeNull();
    fireEvent.click(
      within(row).getByRole("button", { name: "Uninstall Hello" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    expect(h.uninstallPlugin).toHaveBeenCalledWith("hello");
    expect(getPreferences(window).pluginsEnabled).toEqual([]);
  });

  it("shows the safe-mode banner and restarts normally", async () => {
    h.set(
      state({
        safeMode: {
          reason: "crashes",
          crashedLaunches: 2,
          pluginsAtCrash: ["hello"],
        },
      }),
    );
    await open();
    const banner = screen.getByTestId("plugins-safe-mode");
    expect(banner.textContent).toContain("after 2 crashes");
    expect(banner.textContent).toContain("hello");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restart normally" }));
    });
    expect(h.runCommandById).toHaveBeenCalledWith("plugins.restartNormally");
  });
});
