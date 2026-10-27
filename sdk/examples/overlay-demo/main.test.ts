import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { readExample } from "../testing/readManifest";

import plugin from "./main.js";

let p: TestPlugin | undefined;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

describe("overlay-demo", () => {
  it("opens an overlay with the command and closes it with the button or the command", async () => {
    p = await boot(readExample("overlay-demo"), plugin);
    expect(p.overlay()).toBeNull();
    await p.run("toggle");
    const view = p.overlay()!.render();
    expect(screen.getByText("Hello from an overlay")).toBeTruthy();
    fireEvent.click(screen.getByText("Close"));
    view.unmount();
    expect(p.overlay()).toBeNull();
    await p.run("toggle");
    expect(p.overlay()).not.toBeNull();
    await p.run("toggle");
    expect(p.overlay()).toBeNull();
  });
});
