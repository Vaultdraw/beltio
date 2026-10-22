import { describe, expect, it, vi } from "vitest";

import { createFakeBackend } from "./fakeBackend";
import { setPluginsBackend } from "./backend";
import { rescanPlugins } from "./manage";

const ensurePluginHost = vi.fn(async (_win: Window) => {});
vi.mock("../boot", () => ({
  ensurePluginHost: (win: Window) => ensurePluginHost(win),
}));
vi.mock("../hostFlag", () => ({
  pluginHostStarted: { get: () => false, subscribe: () => () => {} },
}));

describe("rescanPlugins without a running host", () => {
  it("starts the host through boot first", async () => {
    setPluginsBackend(createFakeBackend([]));
    await rescanPlugins();
    expect(ensurePluginHost).toHaveBeenCalledWith(window);
  });
});
