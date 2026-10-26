/** Per-vault theme, mode and accent: settings.toml parsing and resolution. */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COMMANDS } from "../commands/commands";
import { getRegisteredHandler } from "../commands/handlerRegistry";
import { useVaultAppearance } from "../theme/useVaultAppearance";

import { useVaultThemeCommands } from "../theme/useVaultThemeCommands";
import { VAULT_THEME_COMMAND_IDS } from "../theme/vaultThemeCommands";

import { SETTINGS_SCHEMA } from "../components/settings/schema";
import { DEFAULT_PREFERENCES } from "../vault/preferences";
import {
  PER_VAULT_FIELDS,
  parseVaultSettings,
  resolveSettings,
} from "../vault/vaultSettings";

import type { VaultOverrides } from "../vault/vaultSettings";

const global = Object.fromEntries(
  PER_VAULT_FIELDS.map((f) => [f, DEFAULT_PREFERENCES[f]]),
) as Parameters<typeof resolveSettings>[1];

describe("per-vault theme", () => {
  it("reads appearance.theme, mode and accent_color from settings.toml", () => {
    const { overrides, problems } = parseVaultSettings({
      appearance: { theme: "Nord", mode: "dark", accent_color: "#ff8800" },
    });
    expect(problems).toEqual([]);
    expect(overrides).toEqual({
      colorTheme: "Nord",
      theme: "dark",
      accentColor: "#ff8800",
    });
    expect(resolveSettings(overrides, global)).toMatchObject({
      colorTheme: "Nord",
      theme: "dark",
      accentColor: "#ff8800",
    });
  });

  it("ignores a bad value with a problem; the global value applies", () => {
    const { overrides, problems } = parseVaultSettings({
      appearance: { mode: "dim" },
    });
    expect(overrides).toEqual({});
    expect(problems).toHaveLength(1);
    expect(resolveSettings(overrides, global).theme).toBe(
      DEFAULT_PREFERENCES.theme,
    );
  });

  it("keeps hotkeys and the other appearance keys global", () => {
    const { overrides, problems } = parseVaultSettings({
      appearance: { sync_canvas: true },
      hotkeys: { "file.save": ["Mod+S"] },
    });
    expect(overrides).toEqual({});
    expect(problems.map((p) => p.kind)).toEqual(["unknown", "unknown"]);
  });

  it("marks the theme, mode and accent rows as per vault in Settings", () => {
    const rows = SETTINGS_SCHEMA.filter((r) =>
      ["mode", "colour-theme", "accent-colour"].includes(r.id),
    );
    expect(rows.map((r) => r.perVault)).toEqual([true, true, true]);
  });
});

describe("per-vault theme commands", () => {
  it("pin copies the shown theme, mode and accent in one write; reset removes the overridden ones", async () => {
    const setOverrides = vi.fn(async () => true);
    const vaultSettings = {
      overrides: { colorTheme: "Nord" },
      loaded: true,
      problems: [],
      global,
      effective: { ...global, colorTheme: "Nord", theme: "dark" as const },
      isOverridden: (f: string) => f === "colorTheme",
      setOverride: vi.fn(async () => true),
      setOverrides,
      setEffective: vi.fn(),
    };
    const notify = vi.fn();
    const { unmount } = renderHook(() =>
      useVaultThemeCommands(vaultSettings, notify),
    );
    expect(COMMANDS.map((c) => c.id)).toEqual(
      expect.arrayContaining(Object.values(VAULT_THEME_COMMAND_IDS)),
    );
    await getRegisteredHandler(VAULT_THEME_COMMAND_IDS.pin)?.();
    expect(setOverrides.mock.calls).toEqual([
      [{ colorTheme: "Nord", theme: "dark", accentColor: "" }],
    ]);
    await getRegisteredHandler(VAULT_THEME_COMMAND_IDS.reset)?.();
    expect(setOverrides.mock.calls[1]).toEqual([{ colorTheme: null }]);
    expect(notify.mock.calls.map((c) => c[0])).toEqual([
      "This vault keeps its own theme",
      "This vault uses the global theme",
    ]);
    setOverrides.mockResolvedValueOnce(false);
    await getRegisteredHandler(VAULT_THEME_COMMAND_IDS.pin)?.();
    expect(notify).toHaveBeenLastCalledWith(
      "Could not save this vault's theme",
    );
    unmount();
    expect(getRegisteredHandler(VAULT_THEME_COMMAND_IDS.pin)).toBeUndefined();
  });
});

describe("vault appearance while settings.toml loads", () => {
  it("uses the last overrides seen for the vault, then the loaded ones", () => {
    window.localStorage.clear();
    const { result, rerender } = renderHook(
      (props: { loaded: boolean; overrides: VaultOverrides }) =>
        useVaultAppearance(window, "vault-a", props),
      {
        initialProps: {
          loaded: true,
          overrides: {
            theme: "dark",
            navigatorSort: "name_desc",
          } as VaultOverrides,
        },
      },
    );
    expect(result.current).toEqual({ theme: "dark" });
    // Reopening: not loaded yet, the cache answers.
    rerender({ loaded: false, overrides: {} });
    expect(result.current).toEqual({ theme: "dark" });
    // Loaded with no override: the global look, and the cache forgets it.
    rerender({ loaded: true, overrides: {} });
    expect(result.current).toEqual({});
    rerender({ loaded: false, overrides: {} });
    expect(result.current).toEqual({});
  });
});
