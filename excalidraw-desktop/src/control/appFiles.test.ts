import { describe, expect, it, vi } from "vitest";

import { createTabStore } from "../tabs/tabStore";
import { activate, initialState, openPath } from "../tabs/tabsModel";

import { createAppFiles, type AppFilesDeps } from "./appFiles";
import { moveDestination, relPath, withExt } from "./params";
import { waitForTabs } from "./tabActions";

const renderExport = vi.hoisted(() => vi.fn());
vi.mock("../export/renderExport", () => ({ renderExport }));

const vault = { handle: "h", path: "/v", name: "V", readOnly: false };

const make = (over: Partial<AppFilesDeps> = {}) => {
  const tabStore = createTabStore(initialState());
  const deps: AppFilesDeps = {
    vault,
    repository: {
      readRevision: vi.fn().mockResolvedValue("r1"),
      listDirectory: vi.fn().mockResolvedValue([]),
      readDrawing: vi.fn().mockResolvedValue({ json: "{}" }),
    },
    win: {} as Window & typeof globalThis,
    flushIfOpen: vi.fn().mockResolvedValue(undefined),
    active: null,
    tabStore,
    openVaultAt: vi.fn().mockResolvedValue(vault),
    openDrawing: vi.fn().mockResolvedValue(true),
    createEntry: vi.fn().mockResolvedValue(undefined),
    moveEntry: vi.fn().mockResolvedValue(true),
    trashEntry: vi.fn().mockResolvedValue(undefined),
    busy: (run) => run(),
    ...over,
  };
  return { deps, files: createAppFiles(deps), tabStore };
};

describe("createAppFiles", () => {
  it("maps openDrawing newTab to the new target", async () => {
    const { deps, files } = make();
    await files.openDrawing("a", true);
    await files.openDrawing("a", false);
    expect(deps.openDrawing).toHaveBeenNthCalledWith(1, "a", { target: "new" });
    expect(deps.openDrawing).toHaveBeenNthCalledWith(2, "a", undefined);
  });

  it("existence probes turn NOT_FOUND into false and rethrow others", async () => {
    const { files } = make({
      repository: {
        readRevision: vi.fn().mockRejectedValue({ code: "NOT_FOUND" }),
        listDirectory: vi.fn().mockRejectedValue({ code: "IO_ERROR" }),
        readDrawing: vi.fn(),
      },
    });
    expect(await files.drawingExists("a")).toBe(false);
    await expect(files.folderExists("f")).rejects.toMatchObject({
      code: "IO_ERROR",
    });
  });

  it("exportDrawing flushes, reads, renders inside busy; a missing drawing rejects NOT_FOUND", async () => {
    const order: string[] = [];
    const busy = vi.fn(async (run) => {
      order.push("busy");
      return run();
    });
    const { files, deps } = make({
      busy,
      flushIfOpen: vi.fn(async () => void order.push("flush")),
    });
    (deps.repository.readDrawing as any).mockImplementation(async () => {
      order.push("read");
      return { json: "J" };
    });
    renderExport.mockResolvedValue({ bytes: new Uint8Array(1) });
    const opts = { scale: 1 } as any;
    await files.exportDrawing("d/a.excalidraw", "png", opts);
    expect(order).toEqual(["busy", "flush", "read"]);
    expect(renderExport).toHaveBeenCalledWith(
      "J",
      "a.excalidraw",
      "png",
      opts,
      deps.win,
    );
    (deps.repository.readDrawing as any).mockRejectedValue({
      code: "NOT_FOUND",
    });
    await expect(
      files.exportDrawing("x.excalidraw", "svg", opts),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("busy wraps the mutating cores", async () => {
    const busy = vi.fn((run) => run());
    const { files, deps } = make({ busy });
    await files.trashEntry("a");
    await files.moveEntry("a", "b", true);
    await files.createDrawing("", "n.excalidraw", "{}");
    expect(busy).toHaveBeenCalledTimes(3);
    expect(deps.createEntry).toHaveBeenCalledWith("", "n.excalidraw", "{}");
  });

  it("tab close and focus resolve when the model reflects them", async () => {
    const { files, tabStore, deps } = make();
    tabStore.update((s) =>
      openPath(s, "a.excalidraw", { target: "new", focus: false }),
    );
    const [home, a] = tabStore.getState().tabs;
    deps.activate = (id) => tabStore.update((s) => activate(s, id));
    await files.activateTab(a.id);
    expect(tabStore.getState().activeId).toBe(a.id);
    deps.close = (id) =>
      tabStore.update((s) => ({
        ...s,
        tabs: s.tabs.filter((t) => t.id !== id),
      }));
    await files.closeTab(home.id);
    expect(tabStore.getState().tabs.some((t) => t.id === home.id)).toBe(false);
  });
});

describe("waitForTabs", () => {
  it("gives up after the timeout", async () => {
    const store = createTabStore(initialState());
    await waitForTabs(store, () => false, 10);
  });
});

describe("params", () => {
  it("path helpers", () => {
    expect(withExt("a")).toBe("a.excalidraw");
    expect(withExt("a.EXCALIDRAW")).toBe("a.EXCALIDRAW");
    expect(relPath("/a//b/", "p")).toBe("a/b");
    expect(() => relPath("a/../b", "p")).toThrow();
    expect(() => relPath("", "p")).toThrow();
    expect(moveDestination("x/y.excalidraw", "z/")).toBe("z/y.excalidraw");
    expect(moveDestination("x/y.excalidraw", "/")).toBe("y.excalidraw");
    expect(moveDestination("y", "q/r")).toBe("q/r");
  });
});
