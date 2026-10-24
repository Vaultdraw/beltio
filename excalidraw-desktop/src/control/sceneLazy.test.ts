import { describe, expect, it, vi } from "vitest";

import { createLazySceneMethods, SCENE_METHOD_NAMES } from "./sceneLazy";

describe("createLazySceneMethods", () => {
  it("registers the four scene methods and loads nothing until called", () => {
    const load = vi.fn();
    const m = createLazySceneMethods(load);
    expect(Object.keys(m)).toEqual([...SCENE_METHOD_NAMES]);
    expect(load).not.toHaveBeenCalled();
  });

  it("loads once and forwards params and results", async () => {
    const read = vi.fn((p) => ({ got: p }));
    const load = vi.fn(async () => ({
      "scene.read": read,
      "scene.get": vi.fn(),
      "scene.selection": vi.fn(),
      "scene.apply": vi.fn(),
    }));
    const m = createLazySceneMethods(load);
    expect(await m["scene.read"]({ a: 1 })).toEqual({ got: { a: 1 } });
    await m["scene.read"]({ a: 2 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed load", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("chunk"))
      .mockResolvedValue({ "scene.get": () => "ok" });
    const m = createLazySceneMethods(load);
    await expect(m["scene.get"]({})).rejects.toThrow("chunk");
    expect(await m["scene.get"]({})).toBe("ok");
  });
});
