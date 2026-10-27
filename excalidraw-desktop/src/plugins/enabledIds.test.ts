// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { getRegisteredCommand } from "../commands/registry";
import { updatePreferences } from "../vault/preferences";

import { bootPlugins } from "./boot";
import { enabledPluginIds, extensionOf, isExtensionLinked } from "./enabledIds";

afterEach(() =>
  updatePreferences({ extGraph: true, pluginsEnabled: ["markdown-import"] }),
);

describe("an official plugin tied to an [extensions] switch", () => {
  it("is on while the switch is on, whatever plugins.enabled lists", () => {
    updatePreferences({ extGraph: true, pluginsEnabled: [] });
    expect(enabledPluginIds()).toEqual(["graph"]);
    updatePreferences({ extGraph: false, pluginsEnabled: ["graph"] });
    expect(enabledPluginIds()).toEqual([]);
    expect(isExtensionLinked("graph")).toBe(true);
    expect(isExtensionLinked("markdown-import")).toBe(false);
    expect(extensionOf("graph")).toBe("graph");
  });

  it("registers its commands as stubs only while on, and loads nothing either way", () => {
    updatePreferences({ extGraph: false });
    bootPlugins(window);
    expect(getRegisteredCommand("graph.open")).toBeUndefined();
    updatePreferences({ extGraph: true });
    expect(getRegisteredCommand("graph.open")?.keys.default).toEqual([
      "Mod+Alt+G",
    ]);
    expect(getRegisteredCommand("graph.moveLeft")?.repeat).toBe(true);
    updatePreferences({ extGraph: false });
    expect(getRegisteredCommand("graph.open")).toBeUndefined();
  });
});
