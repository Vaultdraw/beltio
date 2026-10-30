/**
 * Hunter K (2026-10-30), K-6: a plugin may declare an `int` or `number` setting without `max`
 * (sdk/docs/manifest.md: "Optional. Highest allowed value"; the registry then accepts any value,
 * `declaredSettings.ts` "between -inf and inf"). The Settings page still caps its stepper at
 * `max(1000, current)` and `min(0, current)` (DeclaredSettingsPage.tsx:63-64), so typing 5000
 * stores 1000 and a negative value can never be typed: the user cannot set what the plugin
 * accepts. Obsidian's plugin text/number fields take any number the plugin allows.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerPluginSettings } from "../../../plugins/settings/registry";
import { getPreferences } from "../../../vault/preferences";
import {
  SettingsProvider,
  type SettingsContextValue,
} from "../SettingsContext";

import { DeclaredSettingsPage } from "./DeclaredSettingsPage";

let dispose: () => void;
beforeEach(() => {
  window.localStorage.clear();
  dispose = registerPluginSettings("unbounded", [
    { key: "goal", type: "int", title: "Word goal", default: 500 },
    { key: "offset", type: "number", title: "Offset", default: 0 },
  ]);
});
afterEach(() => {
  cleanup();
  dispose();
  window.localStorage.clear();
});

const renderPage = () =>
  render(
    <SettingsProvider
      value={
        { win: window, vault: null, scope: "global" } as SettingsContextValue
      }
    >
      <DeclaredSettingsPage pluginId="unbounded" title="Unbounded" />
    </SettingsProvider>,
  );

const type = (name: string, text: string) => {
  const field = screen.getByRole("spinbutton", { name });
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: "Enter" });
};

const stored = () => getPreferences(window).pluginSettings.unbounded ?? {};

describe("hunter K-6: a plugin number setting without min or max takes any number", () => {
  it("sanity: a value inside the old cap is stored", () => {
    renderPage();
    type("Word goal", "800");
    expect(stored().goal).toBe(800);
  });

  it.fails("toimprove 234: typing 5000 stores 5000 (no max declared)", () => {
    renderPage();
    type("Word goal", "5000");
    expect(stored().goal).toBe(5000);
  });

  it.fails("toimprove 234: typing -20 stores -20 (no min declared)", () => {
    renderPage();
    type("Offset", "-20");
    expect(stored().offset).toBe(-20);
  });
});
