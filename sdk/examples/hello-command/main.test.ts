import { afterEach, describe, expect, it, vi } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { readExample } from "../testing/readManifest";

import plugin from "./main.js";

const ID = "hello-command";
let p: TestPlugin | undefined;

afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

const start = async () => {
  localStorage.clear();
  const activate = vi.spyOn(plugin, "activate");
  p = await boot(readExample(ID), plugin);
  return activate;
};

describe("hello-command", () => {
  it("declares the command with its hotkey", async () => {
    await start();
    const [hello] = p!.info.contributes.commands;
    expect(hello.id).toBe("hello");
    expect(hello.keys).toEqual(["Mod+Alt+Shift+H"]);
  });

  it("does not load until first run, activates once, toasts", async () => {
    const activate = await start();
    expect(activate).not.toHaveBeenCalled();

    await p!.run("hello");
    await p!.run("hello");
    expect(activate).toHaveBeenCalledTimes(1);
    // The host prefixes the plugin name; identical toasts are deduplicated.
    expect(p!.toasts()).toEqual(["Hello: Hello, Vaultdraw!"]);
  });

  it("uses the greeting setting and logs changes", async () => {
    await start();
    await p!.run("hello");
    await p!.setSetting("greeting", "Hi");
    await p!.flush();
    await p!.run("hello");
    expect(p!.toasts()).toContain("Hello: Hi, Vaultdraw!");
    expect(p!.log().some((l) => /greeting is now Hi/.test(l.text))).toBe(true);
    await p!.setSetting("greeting", "Hello");
  });

  it("costs nothing once disabled", async () => {
    await start();
    await p!.run("hello");
    await p!.disable();
    await expect(p!.run("hello")).rejects.toThrow(/no command/);
    expect(p!.timers()).toBe(0);
  });
});
