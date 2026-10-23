import { describe, expect, it, vi } from "vitest";

import { createDesktopThumbnailStore } from "./desktopStore";

describe("desktop thumbnail store", () => {
  it("looks up through thumbs_lookup", async () => {
    const result = { vaultId: "v", items: [{ rev: "r", state: "hit" }] };
    const invoke = vi.fn(async () => result) as any;
    const s = createDesktopThumbnailStore({ invoke });
    expect(await s.lookup("h", ["a b.excalidraw"], 3)).toBe(result);
    expect(invoke).toHaveBeenCalledWith("thumbs_lookup", {
      handle: "h",
      paths: ["a b.excalidraw"],
      renderVersion: 3,
      failVersion: 3,
    });
    await s.lookup("h", ["a"], 22, 1022);
    expect(invoke).toHaveBeenLastCalledWith("thumbs_lookup", {
      handle: "h",
      paths: ["a"],
      renderVersion: 22,
      failVersion: 1022,
    });
  });

  it("puts the PNG as the raw body with headers; an empty body for a fail marker", async () => {
    const invoke = vi.fn(async () => ({
      url: "vdthumb://localhost/v/r.png",
    })) as any;
    const s = createDesktopThumbnailStore({ invoke });
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    expect(await s.put("h/1", "föld/a b.excalidraw", "r", blob, 2)).toBe(
      "vdthumb://localhost/v/r.png",
    );
    const [cmd, body, opts] = invoke.mock.calls[0];
    expect(cmd).toBe("thumbs_put");
    expect(Array.from(body as Uint8Array)).toEqual([1, 2, 3]);
    expect(opts.headers).toEqual({
      "x-handle": "h%2F1",
      "x-path": encodeURIComponent("föld/a b.excalidraw"),
      "x-revision": "r",
      "x-kind": "png",
      "x-render-version": "2",
    });
    invoke.mockResolvedValueOnce({ url: null });
    expect(await s.put("h", "a", "r", null, 2)).toBeNull();
    const [, failBody, failOpts] = invoke.mock.calls[1];
    expect((failBody as Uint8Array).length).toBe(0);
    expect(failOpts.headers["x-kind"]).toBe("fail");
  });

  it("builds vdthumb urls and clears by handle", async () => {
    const invoke = vi.fn(async () => undefined) as any;
    const s = createDesktopThumbnailStore({ invoke });
    expect(s.urlFor("0123456789abcdef", "ab", 22)).toBe(
      "vdthumb://localhost/0123456789abcdef/ab.v22.png",
    );
    await s.clear("h");
    expect(invoke).toHaveBeenCalledWith("thumbs_clear", { handle: "h" });
  });
});
