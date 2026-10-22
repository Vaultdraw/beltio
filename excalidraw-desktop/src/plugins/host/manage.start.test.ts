import { describe, expect, it, vi } from "vitest";

import { createFakeBackend } from "./fakeBackend";
import { setPluginsBackend } from "./backend";
import { rescanPlugins } from "./manage";

const ensurePluginHost = vi.fn(async () => {});
vi.mock("../boot", () => ({
  ensurePluginHost: (...a: unknown[]) => ensurePluginHost(...a),
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
