/**
 * QA regression: a config.toml problem banner used to share the transient
 * global alert, so any unrelated setGlobalAlert(null) (opening a drawing…)
 * hid it for good while the file was still broken.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toastStore } from "../toasts/toastStore";
import { VaultApp } from "../VaultApp";
import {
  disposeSettings,
  initSettings,
  reloadSettings,
} from "../vault/settingsSync";

import { FakeVaultRepository } from "./fakeVaultRepository";
import { SAMPLE_SCENE } from "./fixtures";

const backend = () => {
  const state = {
    configError: { message: "expected `=`", line: 3 } as {
      message: string;
      line: number | null;
    } | null,
  };
  const invoke = vi.fn(async (cmd: string) => {
    if (cmd === "load_settings") {
      return {
        configDir: "/c",
        configPath: "/c/config.toml",
        statePath: "/s/state.json",
        config: state.configError ? null : {},
        configError: state.configError,
        state: {},
      };
    }
    return undefined;
  });
  const listen = vi.fn(async () => () => {});
  return { state, invoke, listen };
};

afterEach(() => disposeSettings());

const banner = () => screen.queryByTestId("settings-problem-banner");

describe("settings problem banner", () => {
  it("survives unrelated alert clears, is dismissible, and returns when the problem changes", async () => {
    const b = backend();
    await initSettings(window, {
      tauri: true,
      invoke: b.invoke as any,
      listen: b.listen as any,
    });
    const repo = new FakeVaultRepository();
    repo.seedDrawing("notes.excalidraw", SAMPLE_SCENE);
    render(<VaultApp repository={repo} initialVault={repo.vault} />);

    expect(banner()).toHaveTextContent("config.toml line 3: expected `=`");

    // Opening a drawing clears the global alert; the banner must stay.
    const tree = within(screen.getByLabelText("Vault File Navigator"));
    await waitFor(() => expect(tree.getByText("notes")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(tree.getByText("notes"));
    });
    expect(banner()).toHaveTextContent("config.toml line 3");

    // Dismiss: hidden while the text is unchanged…
    fireEvent.click(screen.getByLabelText("Dismiss settings problem"));
    expect(banner()).toBeNull();
    await act(async () => {
      await reloadSettings();
    });
    expect(banner()).toBeNull();

    // …and shown again for a different problem.
    b.state.configError = { message: "invalid table header", line: 7 };
    await act(async () => {
      await reloadSettings();
    });
    expect(banner()).toHaveTextContent("config.toml line 7");

    // Fixed: gone.
    b.state.configError = null;
    await act(async () => {
      await reloadSettings();
    });
    expect(banner()).toBeNull();
  });

  // Regression (review 3): unknown keys are warnings: a toast, not the
  // persistent error banner.
  it("an unknown key is a toast, not the error banner", async () => {
    toastStore.clear();
    const invoke = vi.fn(async (cmd: string) =>
      cmd === "load_settings"
        ? {
            configDir: "/c",
            configPath: "/c/config.toml",
            statePath: "/s/state.json",
            config: { interface: { zom: 1 } },
            configError: null,
            state: {},
          }
        : undefined,
    );
    await initSettings(window, {
      tauri: true,
      invoke: invoke as any,
      listen: (async () => () => {}) as any,
    });
    const repo = new FakeVaultRepository();
    render(<VaultApp repository={repo} initialVault={repo.vault} />);
    const message =
      "config.toml: unknown key interface.zom (ignored; did you mean interface.zoom?)";
    await waitFor(() =>
      expect(toastStore.getSnapshot().toasts.map((t) => t.message)).toEqual([
        message,
      ]),
    );
    expect(banner()).toBeNull();
    // A reload with the same warning does not toast again.
    await act(async () => {
      await reloadSettings();
    });
    expect(toastStore.getSnapshot().toasts).toHaveLength(1);
    toastStore.clear();
  });
});
