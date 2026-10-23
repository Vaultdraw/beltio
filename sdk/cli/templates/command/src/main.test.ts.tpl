import { afterEach, describe, expect, it } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import plugin from "./main";

let p: TestPlugin | undefined;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

const manifest = {
  id: "__ID__",
  name: "__NAME__",
  contributes: {
    commands: [{ id: "hello", title: "__NAME__: say hello" }],
    settings: [
      { key: "greeting", type: "string", title: "Greeting", default: "Hello" },
    ],
  },
};

describe("__ID__", () => {
  it("toasts the greeting", async () => {
    p = await boot(manifest as never, plugin);
    await p.run("hello");
    // The host prefixes the plugin name to toasts.
    expect(p.toasts()).toEqual(["__NAME__: Hello, Vaultdraw!"]);
  });
});
