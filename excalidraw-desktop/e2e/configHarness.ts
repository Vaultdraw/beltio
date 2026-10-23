import { initSettings, type InvokeFn } from "../src/vault/settingsSync";

/**
 * ?config=1: settings in config-folder mode over a fake native side. The
 * parsed config.toml is `window.__e2eConfig` (set it with addInitScript;
 * change it, then press Reload in Settings, to simulate an edit). Writes are
 * accepted and dropped. Opt-in: no other spec is affected.
 */
export function startConfigHarness(win: Window) {
  const w = win as Window & { __e2eConfig?: Record<string, unknown> };
  const invoke = (async (cmd: string) => {
    if (cmd === "load_settings") {
      return {
        configDir: "/e2e/vaultdraw",
        configPath: "/e2e/vaultdraw/config.toml",
        statePath: "/e2e/state.json",
        config: w.__e2eConfig ?? {},
        configError: null,
        state: {},
      };
    }
    return null;
  }) as InvokeFn;
  return initSettings(win, {
    tauri: true,
    invoke,
    listen: (async () => () => {}) as never,
  });
}
