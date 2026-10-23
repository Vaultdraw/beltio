/**
 * Regression (review 4): console.warn deduped only against the previous load,
 * so a failed reload made the next one log every problem again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  disposeSettings,
  initSettings,
  reloadSettings,
} from "../vault/settingsSync";

afterEach(() => disposeSettings());

describe("config problem logging", () => {
  it("logs each problem once per session, across a failed reload", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let broken = false;
    const invoke = vi.fn(async (cmd: string) =>
      cmd === "load_settings"
        ? {
            configDir: "/c",
            configPath: "/c/config.toml",
            statePath: "/s/state.json",
            config: broken ? null : { interface: { zom: 1 } },
            configError: broken ? { message: "expected `=`", line: 2 } : null,
            state: {},
          }
        : undefined,
    );
    await initSettings(window, {
      tauri: true,
      invoke: invoke as any,
      listen: (async () => () => {}) as any,
    });
    broken = true;
    await reloadSettings();
    broken = false;
    await reloadSettings();
    const unknown = warn.mock.calls.filter((c) =>
      String(c[0]).includes("unknown key interface.zom"),
    );
    expect(unknown).toHaveLength(1);
    expect(
      warn.mock.calls.filter((c) => String(c[0]).includes("expected `=`")),
    ).toHaveLength(1);
    warn.mockRestore();
  });
});
