import { afterEach, describe, expect, it, vi } from "vitest";

import { getRegisteredHandler } from "../../commands/handlerRegistry";
import { toastStore } from "../../toasts/toastStore";
import { updatePreferences } from "../../vault/preferences";

import { ensureActive } from "./activation";
import { makePluginInfo } from "./fakeBackend";
import { PERMISSION_TEXT, needsReview, permissionText } from "./permissions";
import { startPluginHost } from "./start";
import { setupHost, tick, withCommands } from "./testUtils";

import type { PluginInfo } from "./types";

const withReview = (
  id: string,
  state: PluginInfo["review"]["state"],
  permissions: string[],
  added: string[],
): PluginInfo => ({
  ...withCommands(id, "go"),
  permissions,
  review: { state, added },
});

let stop: (() => void) | undefined;
afterEach(async () => {
  updatePreferences({ pluginsEnabled: [] });
  await tick();
  stop?.();
  toastStore.clear();
  vi.restoreAllMocks();
});

const run = async (infos: PluginInfo[], activate = vi.fn()) => {
  const modules = Object.fromEntries(
    infos.map((i) => [i.id, { activate } as never]),
  );
  const h = setupHost(infos, modules);
  const host = await startPluginHost(window, (r) => r());
  stop = host.stop;
  updatePreferences({ pluginsEnabled: infos.map((i) => i.id) });
  await tick();
  return { h, activate };
};

describe("consent load gate", () => {
  it("a plugin with a new write permission registers nothing and never loads", async () => {
    const info = withReview("held", "review", ["vault.write"], ["vault.write"]);
    const { h, activate } = await run([info]);
    expect(getRegisteredHandler("held.go")).toBeUndefined();
    expect(await ensureActive("held")).toBe(false);
    expect(h.loads).toEqual([]);
    expect(activate).not.toHaveBeenCalled();
  });

  it("confirming the permissions lets it load", async () => {
    const info = withReview("held", "review", ["vault.write"], ["vault.write"]);
    const { h } = await run([info]);
    h.backend.plugins = [{ ...info, review: { state: "ok", added: [] } }];
    const { rescanPlugins } = await import("./manage");
    await rescanPlugins();
    await tick();
    expect(getRegisteredHandler("held.go")).toBeDefined();
  });

  it("a new read permission loads, tells the user once and records it", async () => {
    const info = withReview("noted", "notice", ["vault.read"], ["vault.read"]);
    const { h, activate } = await run([info]);
    expect(await ensureActive("noted")).toBe(true);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(h.backend.consentCalls).toEqual(["noted"]);
    const msgs = toastStore.getSnapshot().toasts.map((x) => x.message);
    expect(msgs).toEqual(["noted now can: read the drawings in your vault."]);
  });

  it("a confirmed plugin and a plugin with no permissions are quiet", async () => {
    const quiet = makePluginInfo("quiet");
    const ok = withReview("ok-one", "ok", ["vault.read"], []);
    const { h } = await run([quiet, ok]);
    expect(await ensureActive("ok-one")).toBe(true);
    expect(h.backend.consentCalls).toEqual([]);
    expect(toastStore.getSnapshot().toasts).toEqual([]);
  });
});

describe("consent text", () => {
  it("covers exactly the permissions the manifest schema allows", async () => {
    const schema = (await import(
      "../../../../sdk/api/plugin.schema.json"
    )) as unknown as {
      default: { properties: { permissions: { items: { enum: string[] } } } };
    };
    expect(Object.keys(PERMISSION_TEXT).sort()).toEqual(
      [...schema.default.properties.permissions.items.enum].sort(),
    );
  });

  it("has plain words per permission and falls back to the name", () => {
    expect(permissionText("vault.read")).toBe(
      "Read the drawings in your vault",
    );
    expect(permissionText("vault.write")).toBe("Create drawings in your vault");
    expect(permissionText("future.thing")).toBe("future.thing");
    expect(needsReview(makePluginInfo("a"))).toBe(false);
  });
});
