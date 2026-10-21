import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  attachVaultSettings,
  detachVaultSettings,
  getVaultSettingsSnapshot,
} from "../../../vault/vaultSettings";

import { registerPluginSettings } from "../../../plugins/settings/registry";
import { getPreferences } from "../../../vault/preferences";
import {
  SettingsProvider,
  type SettingsContextValue,
} from "../SettingsContext";

import { DeclaredSettingsPage } from "./DeclaredSettingsPage";

const context = (over: Partial<SettingsContextValue> = {}) =>
  ({
    win: window,
    vault: null,
    scope: "global",
    ...over,
  } as SettingsContextValue);

let dispose: () => void;
beforeEach(() => {
  window.localStorage.clear();
  dispose = registerPluginSettings("demo", [
    { key: "on", type: "bool", title: "Enabled", default: false },
    { key: "size", type: "int", title: "Size", default: 5, min: 1, max: 9 },
    {
      key: "mode",
      type: "select",
      title: "Mode",
      default: "a",
      options: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
    },
    { key: "tint", type: "color", title: "Tint", default: "#336699" },
  ]);
});
afterEach(() => {
  detachVaultSettings();
  cleanup();
  dispose();
  window.localStorage.clear();
});

const renderPage = () =>
  render(
    <SettingsProvider value={context()}>
      <DeclaredSettingsPage pluginId="demo" title="Demo" />
    </SettingsProvider>,
  );

describe("DeclaredSettingsPage", () => {
  it("renders one row per declaration with defaults", () => {
    renderPage();
    expect(screen.getByRole("switch", { name: "Enabled" })).not.toBeChecked();
    expect(screen.getByRole("spinbutton", { name: "Size" })).toHaveTextContent(
      "5",
    );
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByTestId("settings-scope")).toBeNull(); // no vault open
  });

  it("writes edits to the global preferences", () => {
    renderPage();
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase Size" }));
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(getPreferences(window).pluginSettings).toEqual({
      demo: { on: true, size: 6, mode: "b" },
    });
    expect(screen.getByRole("switch", { name: "Enabled" })).toBeChecked();
  });

  it("writes a colour from the hex field and resets to the default", () => {
    renderPage();
    const hex = screen.getAllByRole("textbox")[0];
    fireEvent.change(hex, { target: { value: "#ff0000" } });
    fireEvent.blur(hex);
    expect(getPreferences(window).pluginSettings.demo?.tint).toBe("#ff0000");
    fireEvent.click(screen.getByRole("button", { name: "Reset Tint" }));
    expect(getPreferences(window).pluginSettings).toEqual({});
  });

  it("edits the vault override in vault scope", async () => {
    await attachVaultSettings(window, "h", { tauri: false });
    render(
      <SettingsProvider
        value={context({
          scope: "vault",
          vault: { handle: "h", name: "V", path: "/v", readOnly: false },
        })}
      >
        <DeclaredSettingsPage pluginId="demo" title="Demo" />
      </SettingsProvider>,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
    await screen.findAllByText("Overridden");
    expect(getVaultSettingsSnapshot().pluginOverrides).toEqual({
      demo: { on: true },
    });
    expect(getPreferences(window).pluginSettings).toEqual({});
    fireEvent.click(
      screen.getByRole("button", { name: "Reset Enabled to global" }),
    );
    await screen.findAllByText("Inherited from global");
    expect(getVaultSettingsSnapshot().pluginOverrides).toEqual({});
  });
});
