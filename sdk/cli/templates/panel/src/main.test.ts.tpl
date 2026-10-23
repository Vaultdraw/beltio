import { fireEvent, screen } from "@testing-library/react";
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
    commands: [{ id: "open", title: "__NAME__: open panel" }],
    panels: [{ id: "main", title: "__NAME__" }],
  },
};

describe("__ID__", () => {
  it("opens the panel and counts clicks", async () => {
    p = await boot(manifest as never, plugin);
    await p.openPanel("main");
    expect(screen.getByTestId("count").textContent).toBe("Clicked 0 times");
    fireEvent.click(screen.getByRole("button", { name: "Click me" }));
    expect(screen.getByTestId("count").textContent).toBe("Clicked 1 times");
  });
});
