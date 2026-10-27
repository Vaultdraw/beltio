import { describe, expect, it } from "vitest";

import { restoreExtensionDefaults } from "../extensionSwitches/extensionCommands";
import { configToPreferences } from "../vault/settingsSync";
import { getPreferences, updatePreferences } from "../vault/preferences";

import { resolveOfficial } from "./officialPlugins";

const prefs = (config: Record<string, unknown>) =>
  configToPreferences(config).values;

describe("official plugins are on unless turned off", () => {
  it("an old list without the gallery gets it on (and keeps the user's own plugin)", () => {
    const v = prefs({ plugins: { enabled: ["markdown-import", "mine"] } });
    expect(v.pluginsEnabled).toEqual([
      "markdown-import",
      "mine",
      "gallery",
      "graph",
    ]);
    expect(v.pluginsDisabled).toEqual([]);
  });

  it("an old list gets every official plugin on, markdown-import included", () => {
    const v = prefs({ plugins: { enabled: [] } });
    expect(v.pluginsEnabled).toEqual(["markdown-import", "gallery", "graph"]);
    expect(v.pluginsDisabled).toEqual([]);
  });

  it("a plugin in plugins.disabled stays off, a new one is on", () => {
    const v = prefs({
      plugins: { enabled: ["markdown-import"], disabled: ["gallery"] },
    });
    expect(v.pluginsEnabled).toEqual(["markdown-import", "graph"]);
    expect(v.pluginsDisabled).toEqual(["gallery"]);
  });

  it("nothing saved: every official plugin is on", () => {
    expect(resolveOfficial(undefined, undefined)).toEqual({
      enabled: ["markdown-import", "gallery", "graph"],
      disabled: [],
    });
  });

  it("turning one off records it; Restore defaults turns all official plugins on", () => {
    updatePreferences({ pluginsEnabled: ["markdown-import", "mine"] });
    expect(getPreferences().pluginsDisabled).toEqual(["gallery", "graph"]);
    restoreExtensionDefaults();
    expect(getPreferences().pluginsEnabled).toEqual([
      "markdown-import",
      "mine",
      "gallery",
      "graph",
    ]);
    expect(getPreferences().pluginsDisabled).toEqual([]);
  });
});
