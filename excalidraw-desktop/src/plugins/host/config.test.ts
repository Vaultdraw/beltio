import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "../../vault/preferences";
import {
  configToPreferences,
  parseHotkeysTable,
  preferencesToConfigChanges,
} from "../../vault/settingsSync";

describe("[plugins] enabled", () => {
  it("defaults to none and parses valid ids", () => {
    expect(configToPreferences({}).values.pluginsEnabled).toEqual([]);
    const ok = configToPreferences({ plugins: { enabled: ["hello-command"] } });
    expect(ok.values.pluginsEnabled).toEqual(["hello-command"]);
    expect(ok.problems).toEqual([]);
  });

  it("rejects bad ids with a problem", () => {
    const bad = configToPreferences({ plugins: { enabled: ["Bad Id"] } });
    expect(bad.values.pluginsEnabled).toEqual([]);
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
