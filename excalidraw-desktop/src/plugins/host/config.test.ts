import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "../../vault/preferences";

import {
  configToPreferences,
  parseHotkeysTable,
  preferencesToConfigChanges,
} from "../../vault/settingsSync";

import { syncPlugins } from "./index";

describe("[plugins] enabled", () => {
  it("defaults to the official markdown-import and parses valid ids; [] turns it off", () => {
    expect(configToPreferences({}).values.pluginsEnabled).toEqual([
      "markdown-import",
      "gallery",
      "graph",
      "mermaid",
      "formula",
      "pdf-import",
      "favourites",
      "auto-export",
      "table",
    ]);
    expect(
      configToPreferences({ plugins: { enabled: [] } }).values.pluginsEnabled,
    ).toEqual([
      "markdown-import",
      "gallery",
      "graph",
      "mermaid",
      "formula",
      "pdf-import",
      "favourites",
      "auto-export",
      "table",
    ]); // an old list: official plugins are on
    const ok = configToPreferences({ plugins: { enabled: ["hello-command"] } });
    expect(ok.values.pluginsEnabled).toEqual([
      "hello-command",
      "markdown-import",
      "gallery",
      "graph",
      "mermaid",
      "formula",
      "pdf-import",
      "favourites",
      "auto-export",
      "table",
    ]);
    expect(ok.problems).toEqual([]);
  });

  it("rejects bad ids with a problem", () => {
    const bad = configToPreferences({ plugins: { enabled: ["Bad Id"] } });
    expect(bad.values.pluginsEnabled).toEqual([
      "markdown-import",
      "gallery",
      "graph",
      "mermaid",
      "formula",
      "pdf-import",
      "favourites",
      "auto-export",
      "table",
    ]);
    expect(bad.problems[0].key).toBe("plugins.enabled");
  });

  it("round-trips to a config change", () => {
    const next = { ...DEFAULT_PREFERENCES, pluginsEnabled: ["a-b"] };
    const changes = preferencesToConfigChanges(DEFAULT_PREFERENCES, next);
    expect(changes).toContainEqual({ key: "plugins.enabled", value: ["a-b"] });
  });
});

describe("hotkeys of plugin commands", () => {
  it("keeps plugin-namespaced ids without a problem, still flags built-in typos", () => {
    const t = parseHotkeysTable({
      "hello-command.say": ["Mod+Alt+H"],
      "library.nope": ["Mod+Alt+J"],
    });
    expect(t.hotkeys["hello-command.say"]).toEqual(["Mod+Alt+H"]);
    expect(t.problems.map((p) => p.key)).toEqual(["hotkeys.library.nope"]);
  });
});

describe("a config written when the Frames plugin existed", () => {
  const old = {
    plugins: { enabled: ["frames", "hello-command"], disabled: ["frames"] },
    plugin: { frames: { transition: "fade", background: "#101010" } },
    hotkeys: { "frames.next": ["N"] },
  };

  it("loads with no problem and no official plugin named frames", () => {
    const r = configToPreferences(old);
    expect(r.problems).toEqual([]);
    expect(r.values.pluginsDisabled).toEqual([]);
  });

  it("the plugin host quietly skips an enabled id it does not know", () => {
    expect(() => syncPlugins([], ["frames", "hello-command"])).not.toThrow();
    expect(syncPlugins([], ["frames"]).started).toEqual([]);
  });
});
