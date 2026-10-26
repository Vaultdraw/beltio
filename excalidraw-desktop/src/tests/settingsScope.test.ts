/** Settings scope: session store, schema flags, resolution, palette commands. */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COMMANDS } from "../commands/commands";
import {
  appCommandHandlers,
  type AppCommandActions,
} from "../commands/useAppCommands";
import { SETTINGS_SCHEMA } from "../components/settings/schema";
import {
  getSettingsScope,
  setSettingsScope,
  subscribeSettingsScope,
  targetHasVaultRows,
} from "../components/settings/settingsScope";
import { DEFAULT_PREFERENCES } from "../vault/preferences";
import {
  PER_VAULT_FIELDS,
  resolveSetting,
  resolveSettings,
} from "../vault/vaultSettings";

beforeEach(() => setSettingsScope("global"));

describe("settings scope store", () => {
  it("defaults to global, remembers the choice and notifies on change only", () => {
    expect(getSettingsScope()).toBe("global");
    const listener = vi.fn();
    const off = subscribeSettingsScope(listener);
    setSettingsScope("vault");
    setSettingsScope("vault");
    expect(getSettingsScope()).toBe("vault");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    setSettingsScope("global");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("per-vault schema rows", () => {
  it("flags exactly the overridable settings", () => {
    const flagged = SETTINGS_SCHEMA.filter((s) => s.perVault).map((s) => s.id);
    expect(flagged.sort()).toEqual(
      [
        "mode",
        "colour-theme",
        "accent-colour",
        "sort-order",
        "activity-bar",
        "activity-bar-entries",
        "paper",
        "tool-rectangle",
        "tool-diamond",
        "tool-ellipse",
        "tool-arrow",
        "tool-line",
        "tool-text",
        "new-drawing-folder",
        "plugins-installed",
        "templates-folder",
        "history-enabled",
        "history-interval",
        "history-keep-all",
        "history-keep-hourly",
        "history-keep-daily",
        "history-keep-weekly",
        "history-size-cap",
        "history-highlight",
        "tabs-open-from-navigator",
        "tabs-restore",
      ].sort(),
    );
  });

  it("knows which targets have per-vault rows", () => {
    expect(targetHasVaultRows("history")).toBe(true);
    expect(targetHasVaultRows("tools:arrow")).toBe(true);
    expect(targetHasVaultRows("tools:pen")).toBe(false);
    expect(targetHasVaultRows("hotkeys")).toBe(false);
    expect(targetHasVaultRows("links")).toBe(false);
  });
});

describe("resolution: override wins only when set", () => {
  const global = Object.fromEntries(
    PER_VAULT_FIELDS.map((f) => [f, DEFAULT_PREFERENCES[f]]),
  ) as Parameters<typeof resolveSettings>[1];

  it("uses the global value without an override", () => {
    expect(resolveSetting("navigatorSort", {}, global)).toBe(
      global.navigatorSort,
    );
  });

  it("uses the override, including empty values, and the global again once removed", () => {
    expect(
      resolveSetting("navigatorSort", { navigatorSort: "name_desc" }, global),
    ).toBe("name_desc");
    expect(
      resolveSetting("historyEnabled", { historyEnabled: false }, global),
    ).toBe(false);
    expect(resolveSetting("toolArrow", { toolArrow: {} }, global)).toEqual({});
    const { navigatorSort: _removed, ...rest } = {
      navigatorSort: "name_desc" as const,
    };
    expect(resolveSettings(rest, global).navigatorSort).toBe(
      global.navigatorSort,
    );
  });
});

describe("palette commands", () => {
  it.each([
    ["settings.scope.global", "global", "Settings: Edit global settings"],
    ["settings.scope.vault", "vault", "Settings: Edit this vault's settings"],
  ] as const)("%s sets the scope and opens Settings", (id, scope, title) => {
    const def = COMMANDS.find((c) => c.id === id);
    expect(def?.title).toBe(title);
    expect(def?.category).toBe("Settings");
    expect(def?.when).toContain("vaultOpen");
    expect(def?.when).toContain("!modalOpen");
    const openSettings = vi.fn();
    const handlers = appCommandHandlers({
      openSettings,
    } as unknown as AppCommandActions);
    setSettingsScope(scope === "vault" ? "global" : "vault");
    handlers[id]?.();
    expect(getSettingsScope()).toBe(scope);
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});
