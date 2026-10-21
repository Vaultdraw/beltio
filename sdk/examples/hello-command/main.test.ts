import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCommand } from "../../../excalidraw-desktop/src/commands/commands";
import { getRegisteredHandler } from "../../../excalidraw-desktop/src/commands/handlerRegistry";
import { getRuntime } from "../../../excalidraw-desktop/src/plugins/host/activation";
import { getPluginLog } from "../../../excalidraw-desktop/src/plugins/host/errors";
import { startPluginHost } from "../../../excalidraw-desktop/src/plugins/host/start";
import {
  enable,
  registrySizes,
  setupHost,
  tick,
} from "../../../excalidraw-desktop/src/plugins/host/testUtils";
import { setPluginSetting } from "../../../excalidraw-desktop/src/plugins/settings/pluginSettings";
import { toastStore } from "../../../excalidraw-desktop/src/toasts/toastStore";
import { readExample } from "../testing/readManifest";

import plugin from "./main.js";

const ID = "hello-command";
const COMMAND = `${ID}.hello`;
const toasts = () => toastStore.getSnapshot().toasts.map((t) => t.message);
let stop: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
  toastStore.clear();
});
afterEach(async () => {
  enable([]);
  await tick();
  stop?.();
  stop = undefined;
});

const boot = async () => {
  const activate = vi.spyOn(plugin, "activate");
  const h = setupHost([readExample(ID)], { [ID]: plugin });
  stop = (await startPluginHost(window, (run) => run())).stop;
  return { ...h, activate };
};

describe("hello-command", () => {
  it("is not enabled: nothing registered, nothing loaded", async () => {
    const { loads } = await boot();
    expect(getCommand(COMMAND)).toBeUndefined();
    expect(getRegisteredHandler(COMMAND)).toBeUndefined();
    expect(loads).toEqual([]);
  });

  it("registers a stub, loads on first run, activates once, toasts", async () => {
    const { loads, activate } = await boot();
    enable([ID]);
    expect(getCommand(COMMAND)?.keys.default).toEqual(["Mod+Alt+Shift+H"]);
    expect(getRuntime(ID)?.state).toBe("idle");
    expect(loads).toEqual([]);
    expect(activate).not.toHaveBeenCalled();

    await getRegisteredHandler(COMMAND)!();
    await getRegisteredHandler(COMMAND)!();
    expect(loads).toEqual([ID]);
    expect(activate).toHaveBeenCalledTimes(1);
    // The host prefixes the plugin name; identical toasts are deduplicated.
    expect(toasts()).toEqual(["Hello: Hello, Vaultdraw!"]);
  });

  it("uses the greeting setting and logs changes", async () => {
    await boot();
    enable([ID]);
    await getRegisteredHandler(COMMAND)!();
    await setPluginSetting(ID, "greeting", "Hi", "global");
    toastStore.clear();
    await getRegisteredHandler(COMMAND)!();
    expect(toasts()).toEqual(["Hello: Hi, Vaultdraw!"]);
    expect(
      getPluginLog(ID).some((l) => /greeting is now Hi/.test(l.text)),
    ).toBe(true);
  });

  it("costs nothing once disabled", async () => {
    await boot();
    const base = registrySizes(COMMAND);
    enable([ID]);
    await getRegisteredHandler(COMMAND)!();
    enable([]);
    await tick();
    expect(registrySizes(COMMAND)).toEqual(base);
    expect(getCommand(COMMAND)).toBeUndefined();
  });
});
