import { describe, expect, it, vi } from "vitest";

import { createControlBridge, type ControlDeps } from "./bridge";

import type { ControlFiles } from "./windowMethods";
import type { TabsState } from "../tabs/types";

const tabsState = (): TabsState => ({
  tabs: [
    { id: "t1", path: "a.excalidraw", pinned: true, missing: false },
    { id: "t2", path: "b/c.excalidraw", pinned: false, missing: true },
    { id: "t3", path: null, pinned: false, missing: false },
  ],
  activeId: "t1",
  mru: ["t1", "t2", "t3"],
  closed: [],
  nextId: 4,
});

const makeFiles = (over: Partial<ControlFiles> = {}): ControlFiles => {
  let st = tabsState();
  return {
    vault: () => ({ name: "V", path: "/v", readOnly: false }),
    active: () => ({ path: "a.excalidraw", dirty: true }),
    tabState: () => st,
    activateTab: vi.fn(async (id: string) => {
      st = { ...st, activeId: id };
    }),
    closeTab: vi.fn(async (id: string) => {
      st = { ...st, tabs: st.tabs.filter((t) => t.id !== id) };
    }),
    openVault: vi.fn(async (path: string) => ({
      name: "N",
      path,
      readOnly: false,
    })),
    openDrawing: vi.fn().mockResolvedValue(true),
    drawingExists: vi.fn().mockResolvedValue(true),
    folderExists: vi.fn().mockResolvedValue(true),
    createDrawing: vi.fn().mockResolvedValue(undefined),
    moveEntry: vi.fn().mockResolvedValue(true),
    trashEntry: vi.fn().mockResolvedValue(undefined),
    exportDrawing: vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3, 250, 255]),
      mime: "image/png",
      fileName: "a.png",
    }),
    ...over,
  };
};

const make = (over: Partial<ControlFiles> = {}) => {
  const files = makeFiles(over);
  const invoke = vi.fn().mockResolvedValue(undefined);
  const bridge = createControlBridge({
    listen: vi.fn(),
    invoke,
    runner: () => ({} as any),
    overrides: () => ({}),
    appState: () => ({ activeDrawing: null, tabs: 0 }),
    openTarget: async () => true,
    files: () => files,
  } as ControlDeps);
  const call = async (method: string, params: unknown = {}) => {
    await bridge.handle({ rid: 1, method, params });
    const body = invoke.mock.calls.at(-1)![1] as Record<string, any>;
    return body.error ? { error: body.error } : body.result;
  };
  return { files, call };
};

describe("window methods (C3)", () => {
  it("file.openState: open in any tab, dirty only for the active doc", async () => {
    const { call } = make();
    expect(await call("file.openState", { path: "a.excalidraw" })).toEqual({
      open: true,
      dirty: true,
    });
    expect(await call("file.openState", { path: "b/c.excalidraw" })).toEqual({
      open: true,
      dirty: false,
    });
    expect(await call("file.openState", { path: "z.excalidraw" })).toEqual({
      open: false,
      dirty: false,
    });
  });

  it("vault.open needs an absolute path and returns the summary", async () => {
    const { call, files } = make();
    expect((await call("vault.open", { path: "rel" })).error.code).toBe(
      "INVALID_PARAMS",
    );
    expect(await call("vault.open", { path: "/x/y" })).toEqual({
      name: "N",
      path: "/x/y",
      readOnly: false,
    });
    expect(files.openVault).toHaveBeenCalledWith("/x/y");
  });

  it("native error codes pass through", async () => {
    const { call } = make({
      openVault: () => Promise.reject({ code: "LOCKED", message: "busy" }),
    });
    expect((await call("vault.open", { path: "/x" })).error).toMatchObject({
      code: "LOCKED",
      message: "busy",
    });
  });

  it("file.open validates, checks existence, honours newTab", async () => {
    const { call, files } = make();
    expect(
      await call("file.open", { path: "a.excalidraw", newTab: true }),
    ).toEqual({ path: "a.excalidraw", opened: true });
    expect(files.openDrawing).toHaveBeenCalledWith("a.excalidraw", true);
    expect((await call("file.open", { path: "../x" })).error.code).toBe(
      "INVALID_PARAMS",
    );
    (files.drawingExists as any).mockResolvedValue(false);
    expect((await call("file.open", { path: "q.excalidraw" })).error.code).toBe(
      "NOT_FOUND",
    );
  });

  it("NO_VAULT and READ_ONLY guards", async () => {
    const none = make({ vault: () => null });
    expect((await none.call("file.open", { path: "a" })).error.code).toBe(
      "NO_VAULT",
    );
    const ro = make({
      vault: () => ({ name: "V", path: "/v", readOnly: true }),
    });
    for (const [m, p] of [
      ["file.create", { path: "n" }],
      ["file.move", { from: "a", to: "b" }],
      ["file.trash", { path: "a" }],
    ] as const) {
      expect((await ro.call(m, p)).error.code).toBe("READ_ONLY");
    }
  });

  it("file.create appends the extension, checks the parent, passes the scene", async () => {
    const { call, files } = make();
    expect(await call("file.create", { path: "f/New" })).toEqual({
      path: "f/New.excalidraw",
    });
    expect(files.createDrawing).toHaveBeenLastCalledWith(
      "f",
      "New.excalidraw",
      undefined,
    );
    await call("file.create", { path: "Top.excalidraw", scene: { a: 1 } });
    expect(files.createDrawing).toHaveBeenLastCalledWith(
      "",
      "Top.excalidraw",
      '{"a":1}',
    );
    expect(
      (await call("file.create", { path: "x", scene: [1] })).error.code,
    ).toBe("INVALID_PARAMS");
    (files.folderExists as any).mockResolvedValue(false);
    expect((await call("file.create", { path: "no/x" })).error.code).toBe(
      "NOT_FOUND",
    );
  });

  it("file.move: trailing slash keeps the name, abort is CONFLICT", async () => {
    const { call, files } = make();
    expect(
      await call("file.move", { from: "a/b.excalidraw", to: "c/" }),
    ).toEqual({ from: "a/b.excalidraw", to: "c/b.excalidraw" });
    expect(files.moveEntry).toHaveBeenCalledWith(
      "a/b.excalidraw",
      "c/b.excalidraw",
      true,
    );
    await call("file.move", { from: "a", to: "b", rewriteLinks: false });
    expect(files.moveEntry).toHaveBeenLastCalledWith("a", "b", false);
    expect(await call("file.move", { from: "a", to: "b" })).toEqual({
      from: "a",
      to: "b",
    });
    (files.moveEntry as any).mockResolvedValue(false);
    expect((await call("file.move", { from: "a", to: "z" })).error.code).toBe(
      "CONFLICT",
    );
  });

  it("file.trash", async () => {
    const { call, files } = make();
    expect(await call("file.trash", { path: "a.excalidraw" })).toEqual({
      path: "a.excalidraw",
      trashed: true,
    });
    expect(files.trashEntry).toHaveBeenCalledWith("a.excalidraw");
  });

  it("tab.list shape, active-only dirty", async () => {
    const { call } = make();
    expect(await call("tab.list")).toEqual({
      tabs: [
        {
          id: "t1",
          path: "a.excalidraw",
          pinned: true,
          missing: false,
          active: true,
          dirty: true,
        },
        {
          id: "t2",
          path: "b/c.excalidraw",
          pinned: false,
          missing: true,
          active: false,
          dirty: false,
        },
        {
          id: "t3",
          path: null,
          pinned: false,
          missing: false,
          active: false,
          dirty: false,
        },
      ],
      activeId: "t1",
    });
  });

  it("tab.list with tabs disabled: one synthetic entry or empty", async () => {
    const one = make({ tabState: () => null });
    expect((await one.call("tab.list")).tabs).toHaveLength(1);
    const none = make({ tabState: () => null, active: () => null });
    expect(await none.call("tab.list")).toEqual({ tabs: [], activeId: null });
  });

  it("tab.focus by id, index (1-based) and path; tab.close by id or path", async () => {
    const { call, files } = make();
    expect(await call("tab.focus", { id: "t2" })).toEqual({ id: "t2" });
    expect(await call("tab.focus", { index: 3 })).toEqual({ id: "t3" });
    expect(await call("tab.focus", { path: "a.excalidraw" })).toEqual({
      id: "t1",
    });
    expect(files.activateTab).toHaveBeenCalledTimes(3);
    expect((await call("tab.focus", { index: 9 })).error.code).toBe(
      "NOT_FOUND",
    );
    expect((await call("tab.focus", {})).error.code).toBe("INVALID_PARAMS");
    expect(await call("tab.close", { path: "b/c.excalidraw" })).toEqual({
      closed: true,
    });
    expect(files.closeTab).toHaveBeenCalledWith("t2");
    expect(files.tabState()!.tabs.some((t) => t.id === "t2")).toBe(false);
    expect((await call("tab.close", { index: 1 })).error.code).toBe(
      "INVALID_PARAMS",
    );
  });

  it("tab.focus / tab.close report UNAVAILABLE when the outcome is not reached", async () => {
    const { call } = make({
      activateTab: async () => {},
      closeTab: async () => {},
    });
    expect(await call("tab.focus", { id: "t2" })).toMatchObject({
      error: { code: "UNAVAILABLE", data: { id: "t2" } },
    });
    expect(await call("tab.close", { id: "t2" })).toMatchObject({
      error: { code: "UNAVAILABLE", data: { id: "t2" } },
    });
  });

  describe("export.render", () => {
    const defaults = {
      scale: 1,
      dark: false,
      background: true,
      pattern: true,
      embedScene: false,
      pageShaped: false,
    };

    it("passes the CLI defaults and returns base64 bytes", async () => {
      const { call, files } = make();
      const r = await call("export.render", {
        path: "a.excalidraw",
        format: "png",
      });
      expect(files.exportDrawing).toHaveBeenCalledWith(
        "a.excalidraw",
        "png",
        defaults,
      );
      expect(r).toEqual({
        path: "a.excalidraw",
        fileName: "a.png",
        mime: "image/png",
        size: 5,
        bytes: btoa(String.fromCharCode(1, 2, 3, 250, 255)),
      });
    });

    it("passes explicit options through", async () => {
      const { call, files } = make();
      await call("export.render", {
        path: "d/a.excalidraw",
        format: "svg",
        scale: 2.5,
        dark: true,
        background: false,
        pattern: false,
        embedScene: true,
        pageShaped: true,
      });
      expect(files.exportDrawing).toHaveBeenCalledWith(
        "d/a.excalidraw",
        "svg",
        {
          scale: 2.5,
          dark: true,
          background: false,
          pattern: false,
          embedScene: true,
          pageShaped: true,
        },
      );
    });

    it("pdf is passed with the options as given (the renderer forces the background)", async () => {
      const { call, files } = make();
      await call("export.render", {
        path: "a.excalidraw",
        format: "pdf",
        dark: true,
        background: false,
      });
      expect(files.exportDrawing).toHaveBeenCalledWith(
        "a.excalidraw",
        "pdf",
        expect.objectContaining({ dark: true, background: false }),
      );
    });

    it("validates params", async () => {
      const { call, files } = make();
      for (const bad of [
        { path: "a", format: "gif" },
        { path: "a" },
        { path: "../a", format: "png" },
        { path: "a", format: "png", scale: 0.5 },
        { path: "a", format: "png", scale: 4 },
        { path: "a", format: "png", scale: "2" },
        { path: "a", format: "png", dark: "yes" },
        { path: "a", format: "png", embedScene: 1 },
      ]) {
        expect((await call("export.render", bad)).error.code).toBe(
          "INVALID_PARAMS",
        );
      }
      expect(files.exportDrawing).not.toHaveBeenCalled();
    });

    it("round-trips multi-MB bytes", async () => {
      const big = new Uint8Array(5 * 1024 * 1024 + 1);
      for (let i = 0; i < big.length; i += 1) {
        big[i] = (i * 31) & 255;
      }
      const { call } = make({
        exportDrawing: vi.fn().mockResolvedValue({
          bytes: big,
          mime: "image/png",
          fileName: "b.png",
        }),
      });
      const r = await call("export.render", { path: "a", format: "png" });
      const back = Uint8Array.from(atob(r.bytes), (c) => c.charCodeAt(0));
      expect(r.size).toBe(big.length);
      expect(back).toEqual(big);
    });

    it("TOO_LARGE above 32 MiB", async () => {
      const { call } = make({
        exportDrawing: vi.fn().mockResolvedValue({
          bytes: new Uint8Array(32 * 1024 * 1024 + 1),
          mime: "image/png",
          fileName: "b.png",
        }),
      });
      expect(
        (await call("export.render", { path: "a", format: "png" })).error.code,
      ).toBe("TOO_LARGE");
    });

    it("maps an empty canvas to INVALID_FILE and NOT_FOUND passes through", async () => {
      const empty = make({
        exportDrawing: () =>
          Promise.reject(new Error("Cannot export an empty canvas.")),
      });
      expect(
        (await empty.call("export.render", { path: "a", format: "png" })).error,
      ).toMatchObject({
        code: "INVALID_FILE",
        message: "Cannot export an empty canvas",
      });
      const missing = make({
        exportDrawing: () =>
          Promise.reject({ code: "NOT_FOUND", message: "gone" }),
      });
      expect(
        (await missing.call("export.render", { path: "a", format: "png" }))
          .error.code,
      ).toBe("NOT_FOUND");
    });

    it("needs a vault", async () => {
      const { call } = make({ vault: () => null });
      expect(
        (await call("export.render", { path: "a", format: "png" })).error.code,
      ).toBe("NO_VAULT");
    });
  });
});
