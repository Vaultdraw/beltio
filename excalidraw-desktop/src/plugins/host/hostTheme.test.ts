import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOKEN_NAMES } from "../../theme/types";
import { appearanceListenerCount } from "../../vault/appearance";
import { boot, type TestPlugin } from "../testing";

import type { PluginContext } from "../api";
import type { PluginInfo } from "./types";

let t: TestPlugin | undefined;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await t?.dispose();
  t = undefined;
  vi.restoreAllMocks();
});

const bootWith = async (
  activate: (ctx: PluginContext) => void,
  permissions: PluginInfo["permissions"] = [],
) => {
  t = await boot(
    { id: "th", activation: ["onStartupFinished"], permissions },
    { activate },
  );
  return t;
};

describe("ctx.host", () => {
  it("reports the app, the API level and revision, and has()", async () => {
    let seen: PluginContext["host"] | undefined;
    await bootWith((ctx) => {
      seen = ctx.host;
    });
    expect(seen!.app).toMatch(/^\d+\.\d+\.\d+/);
    expect(seen!.api).toEqual({ level: 0, revision: "0.9.0" });
    expect(seen!.has("theme.tokens")).toBe(true);
    expect(seen!.has("commands.register")).toBe(true);
    expect(seen!.has("drawing.saved")).toBe(true);
    expect(seen!.has("vault.list")).toBe(true);
    expect(seen!.has("vault.rename")).toBe(false);
    expect(seen!.has("toString")).toBe(false);
    expect(seen!.has("__proto__")).toBe(false);
    expect(seen!.has(42 as never)).toBe(false);
    expect(Object.isFrozen(seen)).toBe(true);
  });

  it("shows the manifest's declared permissions", async () => {
    let perms: readonly string[] = [];
    await bootWith(
      (ctx) => {
        perms = ctx.manifest.permissions;
      },
      ["vault.read"],
    );
    expect(perms).toEqual(["vault.read"]);
  });
});

describe("ctx.theme", () => {
  it("costs nothing until a plugin reads it", async () => {
    const styles = vi.spyOn(window, "getComputedStyle");
    const before = appearanceListenerCount();
    await bootWith(() => {});
    await t!.flush();
    expect(appearanceListenerCount()).toBe(before);
    expect(styles).not.toHaveBeenCalled();
  });

  it("reads the mode, the tokens and changes", async () => {
    const changes: unknown[] = [];
    let theme!: PluginContext["theme"];
    await bootWith((ctx) => {
      theme = ctx.theme;
      ctx.theme.onChange((e) => changes.push(e));
    });
    expect(theme.mode()).toBe("light");
    const first = theme.tokens();
    expect(Object.keys(first).sort()).toEqual([...TOKEN_NAMES].sort());
    expect(Object.isFrozen(first)).toBe(true);
    expect(theme.tokens()).toBe(first); // cached while nothing changed

    t!.theme.set({
      mode: "dark",
      themeId: "cendre",
      tokens: { "--vault-text": "#eeeeee" },
    });
    expect(changes).toEqual([{ mode: "dark", themeId: "cendre" }]);
    expect(theme.mode()).toBe("dark");
    const next = theme.tokens();
    expect(next).not.toBe(first);
    expect(next["--vault-text"]).toBe("#eeeeee");
    expect(first["--vault-text"]).toBe(""); // the old table is a snapshot
  });

  it("stops notifying after the plugin is disabled, and a throwing callback is attributed", async () => {
    const ok = vi.fn();
    await bootWith((ctx) => {
      ctx.theme.onChange(() => {
        throw new Error("x");
      });
      ctx.theme.onChange(ok);
    });
    expect(appearanceListenerCount()).toBe(2);
    t!.theme.set({ mode: "dark" });
    expect(ok).toHaveBeenCalledTimes(1);
    await t!.disable();
    expect(appearanceListenerCount()).toBe(0);
    t!.theme.set({ mode: "light" });
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
